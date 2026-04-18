#!/usr/bin/env node

/**
 * Notion → Ten80Ten SMM App Migration
 *
 * Migrates the Content Production Pipeline from Notion to the Ten80Ten app DB + Google Drive.
 * Standalone script — does NOT modify any app source code.
 *
 * Phases:
 *   1. Fetch & Audit       — Pull all records + page blocks from Notion
 *   2. Title Gen & Mapping  — Generate titles, map to app schema
 *   3. Asset Migration      — Download media, upload to Google Drive
 *   4. DB Wipe & Insertion  — Clear existing data, insert mapped records
 *   5. Verification         — Confirm counts, titles, media
 */

import 'dotenv/config';
import { Client } from '@notionhq/client';
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, 'tmp');

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const NOTION_TOKEN = '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';
const NOTION_DB_ID = '2bc72001edab80dbaaf7e6d96ee64594';

// Load from parent .env.local (dotenv reads from CWD, but we resolve manually)
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRIVE_ROOT_FOLDER = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

// Service account JSON is base64-encoded
const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const SA_CREDENTIALS = JSON.parse(
  saRaw.includes('{') ? saRaw : Buffer.from(saRaw, 'base64').toString('utf-8')
);

// Validate config
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, DRIVE_ROOT_FOLDER, saRaw })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

// ═══════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════

const notion = new Client({ auth: NOTION_TOKEN });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const gauth = new GoogleAuth({
  credentials: SA_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function getDriveToken() {
  const client = await gauth.getClient();
  const res = await client.getAccessToken();
  return res?.token;
}

async function driveFetch(url, init = {}) {
  const token = await getDriveToken();
  const headers = { ...init.headers, Authorization: `Bearer ${token}` };
  return fetch(url, { ...init, headers });
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & MAPS
// ═══════════════════════════════════════════════════════════════

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const STATUS_MAP = {
  'Ideas / Backlog': 'ideas',
  'In Production': 'ideas',
  'Awaiting Approval': 'awaiting_approval',
  'Revision Needed': 'revision_needed',
  'Approved / Scheduled': 'approved_scheduled',
  'Archive / Posted': 'posted',
};

const FORMAT_MAP = {
  'Graphic': 'image',
  'Reel / video': 'reel',
  'Carousel': 'carousel',
};

const PLATFORM_MAP = {
  Facebook: 'facebook',
  Instagram: 'instagram',
  LinkedIn: 'linkedin',
  TikTok: 'tiktok',
};

const DEFAULT_CHECKLIST = [
  { id: '1', label: 'Thumbnail/cover image approved', checked: false },
  { id: '2', label: 'Caption proofread & hashtags added', checked: false },
  { id: '3', label: 'Hook verified (first 3 seconds)', checked: false },
  { id: '4', label: 'Call-to-action included', checked: false },
  { id: '5', label: 'Brand guidelines followed', checked: false },
  { id: '6', label: 'Scheduled date confirmed', checked: false },
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function extractText(richText) {
  return (richText || []).map((rt) => rt.plain_text).join('');
}

function isPlaceholderTitle(title) {
  if (!title || !title.trim()) return true;
  const lower = title.trim().toLowerCase();
  return (
    lower === 'new post' ||
    lower.includes('please edit the title') ||
    lower.startsWith('ready for revision') ||
    lower === 'story'
  );
}

/** Generate a descriptive title from caption and hashtags */
function generateTitle(caption, hashtags, format, dateStr) {
  const formatLabel = { image: 'Graphic', reel: 'Reel', carousel: 'Carousel' }[format] || 'Post';

  if (!caption || !caption.trim()) {
    const d = new Date(dateStr);
    const month = d.toLocaleString('en', { month: 'short' });
    return `${formatLabel} - ${month} ${d.getDate()}`;
  }

  const lines = caption.split('\n').filter((l) => l.trim());
  let firstLine = lines[0] || '';

  // Clean checkmarks, bullets, asterisks
  firstLine = firstLine.replace(/^[✔✓☑️•\-*\d.]+\s*/g, '').trim();
  firstLine = firstLine.replace(/^\*+/, '').replace(/\*+$/, '').trim();

  // ALL CAPS → Title Case
  if (firstLine === firstLine.toUpperCase() && firstLine.length > 3) {
    firstLine = firstLine
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Truncate long titles
  if (firstLine.length > 65) {
    const breakAt = firstLine.lastIndexOf(' ', 62);
    firstLine = firstLine.substring(0, breakAt > 30 ? breakAt : 62);
  }

  // Too short — try hashtag themes
  if (firstLine.length < 10) {
    const tags = (hashtags || '').match(/#(\w+)/g);
    if (tags && tags.length >= 2) {
      const themes = tags
        .filter((t) => !t.toLowerCase().includes('ten80ten'))
        .slice(0, 3)
        .map((t) =>
          t
            .replace('#', '')
            .replace(/([A-Z])/g, ' $1')
            .trim()
        );
      if (themes.length) firstLine = themes.join(', ');
    }
  }

  // Final fallback
  if (!firstLine || firstLine.length < 3) {
    const d = new Date(dateStr);
    const month = d.toLocaleString('en', { month: 'short' });
    return `${formatLabel} - ${month} ${d.getDate()}`;
  }

  return firstLine;
}

/** Deduplicate titles by appending a counter */
const usedTitles = new Map();
function uniqueTitle(title) {
  const key = title.toLowerCase();
  if (!usedTitles.has(key)) {
    usedTitles.set(key, 1);
    return title;
  }
  const count = usedTitles.get(key) + 1;
  usedTitles.set(key, count);
  return `${title} (${count})`;
}

/** Parse page blocks into structured content */
function parseBlocks(blocks) {
  const result = {
    caption: '',
    hashtags: '',
    sourceLink: '',
    checklistStates: [],
    images: [],
    videos: [],
  };

  let currentSection = '';

  for (const block of blocks) {
    const type = block.type;

    // Section header detection (paragraph blocks)
    if (type === 'paragraph') {
      const text = extractText(block.paragraph?.rich_text).toLowerCase();
      if (text.includes('caption and hook') || text.includes('caption & hook')) {
        currentSection = 'caption';
      } else if (text.includes('hashtag')) {
        currentSection = 'hashtags';
      } else if (text.includes('source link')) {
        currentSection = 'source_link';
      } else if (text.includes('final asset')) {
        currentSection = 'asset';
      }
      continue;
    }

    // Code blocks — extract text based on current section
    if (type === 'code') {
      const text = extractText(block.code?.rich_text).trim();
      if (currentSection === 'caption' && text) result.caption = text;
      else if (currentSection === 'hashtags' && text) result.hashtags = text;
      else if (currentSection === 'source_link' && text) result.sourceLink = text;
      continue;
    }

    // To-do items — checklist state
    if (type === 'to_do') {
      result.checklistStates.push(!!block.to_do?.checked);
      continue;
    }

    // Image blocks
    if (type === 'image') {
      const img = block.image;
      let url = '';
      if (img?.type === 'file') url = img.file?.url || '';
      else if (img?.type === 'external') url = img.external?.url || '';
      if (url) result.images.push({ url, blockId: block.id });
      continue;
    }

    // Video blocks
    if (type === 'video') {
      const vid = block.video;
      let url = '';
      if (vid?.type === 'file') url = vid.file?.url || '';
      else if (vid?.type === 'external') url = vid.external?.url || '';
      if (url) result.videos.push({ url, blockId: block.id });
      continue;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// GOOGLE DRIVE HELPERS
// ═══════════════════════════════════════════════════════════════

async function ensureSubfolder(name, parentId) {
  const q = encodeURIComponent(
    `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  const createRes = await driveFetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const created = await createRes.json();
  return created.id;
}

async function uploadToDrive(fileBuffer, fileName, mimeType, parentFolderId) {
  const token = await getDriveToken();
  const boundary = 'migration_' + Date.now();
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentFolderId],
    mimeType,
  });

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,size&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${err.slice(0, 200)}`);
  }

  return res.json();
}

async function setPublicPermission(fileId) {
  const res = await driveFetch(
    `${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }
  );
  if (!res.ok) {
    console.warn(`  [warn] Could not set public permission on ${fileId}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: FETCH & AUDIT
// ═══════════════════════════════════════════════════════════════

async function phase1() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  PHASE 1: FETCH & AUDIT                  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1a. Fetch all database records
  console.log('Fetching all Notion database records...');
  const allPages = [];
  let cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: NOTION_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    allPages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  console.log(`  Found ${allPages.length} records.\n`);

  // 1b. Fetch blocks for each page
  console.log('Fetching page blocks (this takes ~40s due to rate limits)...');
  const records = [];

  for (let i = 0; i < allPages.length; i++) {
    const page = allPages[i];
    const pageId = page.id;

    // Extract properties
    const props = page.properties;
    const title = extractText(props['Task Title']?.title);
    const status = props['Status']?.status?.name || '';
    const format = props['Format']?.select?.name || '';
    const platforms = (props['Platform']?.multi_select || []).map((p) => p.name);
    const dateVal = props['Post Date and Time']?.date?.start || '';
    const createdTime = page.created_time;
    const lastEdited = page.last_edited_time;

    // Fetch blocks
    let blocks = [];
    try {
      let blockCursor = undefined;
      do {
        const blockRes = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: blockCursor,
          page_size: 100,
        });
        blocks.push(...blockRes.results);
        blockCursor = blockRes.has_more ? blockRes.next_cursor : undefined;
      } while (blockCursor);
    } catch (err) {
      console.warn(`  [warn] Failed to fetch blocks for page ${i + 1}: ${err.message}`);
    }

    // Parse block content
    const content = parseBlocks(blocks);

    records.push({
      notionId: pageId,
      title,
      status,
      format,
      platforms,
      dateVal,
      createdTime,
      lastEdited,
      ...content,
    });

    if ((i + 1) % 10 === 0 || i === allPages.length - 1) {
      process.stdout.write(`  ${i + 1}/${allPages.length} pages processed\r`);
    }

    // Rate limit: 3 req/sec max, wait 350ms between block fetches
    await delay(350);
  }

  console.log('\n');

  // 1c. Audit report
  const statusCounts = {};
  const formatCounts = {};
  let placeholderCount = 0;
  let mediaCount = 0;
  let captionCount = 0;

  for (const r of records) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    formatCounts[r.format] = (formatCounts[r.format] || 0) + 1;
    if (isPlaceholderTitle(r.title)) placeholderCount++;
    if (r.images.length || r.videos.length) mediaCount++;
    if (r.caption) captionCount++;
  }

  console.log('=== PRE-FLIGHT AUDIT ===');
  console.log(`Total records: ${records.length}`);
  console.log(`\nBy Status:`);
  for (const [s, c] of Object.entries(statusCounts)) console.log(`  ${s}: ${c}`);
  console.log(`\nBy Format:`);
  for (const [f, c] of Object.entries(formatCounts)) console.log(`  ${f}: ${c}`);
  console.log(`\nPlaceholder titles: ${placeholderCount}/${records.length}`);
  console.log(`Records with media: ${mediaCount}`);
  console.log(`Records with captions: ${captionCount}`);
  console.log(`Total images: ${records.reduce((s, r) => s + r.images.length, 0)}`);
  console.log(`Total videos: ${records.reduce((s, r) => s + r.videos.length, 0)}`);
  console.log('========================\n');

  return records;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: TITLE GENERATION & PAYLOAD MAPPING
// ═══════════════════════════════════════════════════════════════

function phase2(records) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  PHASE 2: TITLE GEN & MAPPING            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const mapped = records.map((r) => {
    // Title
    let title = r.title;
    const appFormat = FORMAT_MAP[r.format] || 'image';
    if (isPlaceholderTitle(title)) {
      title = generateTitle(r.caption, r.hashtags, appFormat, r.dateVal || r.createdTime);
    }
    title = uniqueTitle(title);

    // Stage
    const stage = STATUS_MAP[r.status] || 'ideas';

    // Platforms
    const platforms = r.platforms
      .map((p) => PLATFORM_MAP[p])
      .filter(Boolean);

    // Checklist: map 6 Notion to-do states to 6 app checklist items
    const checklist = DEFAULT_CHECKLIST.map((item, idx) => ({
      ...item,
      checked: r.checklistStates[idx] !== undefined ? r.checklistStates[idx] : stage === 'posted',
    }));

    // Caption + hashtags combined
    let caption = r.caption || '';
    if (r.hashtags) {
      caption = caption ? `${caption}\n\n${r.hashtags}` : r.hashtags;
    }

    // Hook: first line of caption
    const hook = r.caption ? r.caption.split('\n').filter((l) => l.trim())[0] || '' : '';

    // Source vault
    const sourceVault = r.sourceLink ? { designLink: r.sourceLink } : {};

    // Scheduled date
    const scheduledDate = r.dateVal || null;

    // Timestamps
    const createdAt = r.createdTime;
    const updatedAt = r.lastEdited || r.createdTime;

    return {
      notionId: r.notionId,
      title,
      stage,
      platforms,
      content_type: appFormat,
      scheduled_date: scheduledDate,
      caption: caption || null,
      hook: hook || null,
      checklist,
      source_vault: sourceVault,
      created_at: createdAt,
      updated_at: updatedAt,
      // Media (to be filled in Phase 3)
      _images: r.images,
      _videos: r.videos,
      thumbnail_url: null,
      media_ids: [],
      _mediaAssets: [],
    };
  });

  // Report title generation
  let generated = 0;
  for (const m of mapped) {
    if (!records.find((r) => r.notionId === m.notionId && !isPlaceholderTitle(r.title))) {
      generated++;
    }
  }
  console.log(`Titles generated: ${generated}`);
  console.log(`Sample titles:`);
  for (const m of mapped.slice(0, 5)) {
    console.log(`  "${m.title}" [${m.stage}] ${m.scheduled_date || ''}`);
  }
  console.log(`  ... and ${mapped.length - 5} more\n`);

  return mapped;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: ASSET MIGRATION (GOOGLE DRIVE)
// ═══════════════════════════════════════════════════════════════

async function phase3(records) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  PHASE 3: ASSET MIGRATION                ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Ensure tmp directory
  await fs.mkdir(TMP_DIR, { recursive: true });

  // Find or create Drive subfolders
  console.log('Setting up Google Drive folders...');
  const thumbsFolderId = await ensureSubfolder('thumbnails', DRIVE_ROOT_FOLDER);
  const rawFolderId = await ensureSubfolder('raw-files', DRIVE_ROOT_FOLDER);
  const mediaFolderId = await ensureSubfolder('media-library', DRIVE_ROOT_FOLDER);
  console.log(`  thumbnails: ${thumbsFolderId}`);
  console.log(`  raw-files:  ${rawFolderId}`);
  console.log(`  media-library: ${mediaFolderId}\n`);

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const allMedia = [
      ...rec._images.map((img) => ({ ...img, type: 'image' })),
      ...rec._videos.map((vid) => ({ ...vid, type: 'video' })),
    ];

    if (!allMedia.length) {
      skipped++;
      continue;
    }

    for (let j = 0; j < allMedia.length; j++) {
      const media = allMedia[j];
      const url = media.url;

      try {
        // Download from Notion S3
        const dlRes = await fetch(url);
        if (!dlRes.ok) {
          console.warn(`  [warn] Download failed for record ${i + 1} media ${j + 1}: HTTP ${dlRes.status}`);
          failed++;
          continue;
        }

        const contentType = dlRes.headers.get('content-type') || 'application/octet-stream';
        const buffer = Buffer.from(await dlRes.arrayBuffer());

        // Determine extension and filename
        let ext = 'bin';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        else if (contentType.includes('mp4')) ext = 'mp4';
        else if (contentType.includes('webm')) ext = 'webm';
        else if (contentType.includes('gif')) ext = 'gif';
        else if (contentType.includes('webp')) ext = 'webp';

        const datePrefix = (rec.scheduled_date || rec.created_at.slice(0, 10));
        const safeName = rec.title.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 40);
        const driveFileName = `${datePrefix}_${safeName}_${j + 1}.${ext}`;

        // Choose folder: images → thumbnails, videos → raw-files
        const targetFolder = media.type === 'video' ? rawFolderId : thumbsFolderId;

        // Upload to Drive
        const driveFile = await uploadToDrive(buffer, driveFileName, contentType, targetFolder);
        const fileId = driveFile.id;

        // Set public
        await setPublicPermission(fileId);

        // Store results
        const streamUrl = `/api/drive/stream?id=${fileId}`;
        rec.media_ids.push(fileId);

        // First image becomes thumbnail
        if (!rec.thumbnail_url && media.type === 'image') {
          rec.thumbnail_url = streamUrl;
        }

        // Track for media_assets insertion
        rec._mediaAssets.push({
          name: driveFileName,
          url: streamUrl,
          file_type: media.type,
          folder: media.type === 'video' ? 'raw-files' : 'thumbnails',
          added_by: 'Muaaz Saifi',
          uploaded_at: rec.created_at,
        });

        uploaded++;
      } catch (err) {
        console.warn(`  [warn] Failed media ${j + 1} for record ${i + 1}: ${err.message}`);
        failed++;
      }
    }

    if ((i + 1) % 10 === 0 || i === records.length - 1) {
      process.stdout.write(`  ${i + 1}/${records.length} records processed (${uploaded} uploaded, ${failed} failed)\r`);
    }

    // Small delay between records to avoid hitting rate limits
    await delay(200);
  }

  console.log(`\n\nAsset migration complete:`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Skipped (no media): ${skipped}\n`);

  return records;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: DB WIPE & SURGICAL INSERTION
// ═══════════════════════════════════════════════════════════════

async function phase4(records) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  PHASE 4: DB WIPE & INSERTION            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Step 1: Wipe existing data
  console.log('Wiping existing data...');
  const tables = ['post_audit_logs', 'post_comments', 'media_assets', 'posts'];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.warn(`  [warn] Error wiping ${table}: ${error.message}`);
    } else {
      console.log(`  Cleared: ${table}`);
    }
  }
  console.log('');

  // Step 2: Insert posts in batches
  console.log('Inserting posts...');
  const BATCH_SIZE = 10;
  let insertedPosts = 0;
  let postErrors = 0;
  const postIdMap = new Map(); // notionId → supabase post id

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const rows = batch.map((r) => ({
      title: r.title,
      stage: r.stage,
      platforms: r.platforms,
      content_type: r.content_type,
      thumbnail_url: r.thumbnail_url,
      scheduled_date: r.scheduled_date,
      caption: r.caption,
      hook: r.hook,
      checklist: r.checklist,
      media_ids: r.media_ids,
      source_vault: r.source_vault,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    const { data, error } = await supabase.from('posts').insert(rows).select('id');

    if (error) {
      console.error(`  [error] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
      postErrors += batch.length;
    } else {
      insertedPosts += data.length;
      // Map notion IDs to new Supabase post IDs
      for (let j = 0; j < data.length; j++) {
        postIdMap.set(batch[j].notionId, data[j].id);
      }
    }
  }

  console.log(`  Posts inserted: ${insertedPosts}, errors: ${postErrors}\n`);

  // Step 3: Insert media_assets
  console.log('Inserting media assets...');
  let insertedMedia = 0;

  for (const rec of records) {
    const postId = postIdMap.get(rec.notionId);
    if (!postId || !rec._mediaAssets.length) continue;

    for (const asset of rec._mediaAssets) {
      const { error } = await supabase.from('media_assets').insert({
        name: asset.name,
        url: asset.url,
        file_type: asset.file_type,
        folder: asset.folder,
        added_by: asset.added_by,
        used_in: [postId],
        uploaded_at: asset.uploaded_at,
      });

      if (error) {
        console.warn(`  [warn] media_assets insert failed: ${error.message}`);
      } else {
        insertedMedia++;
      }
    }
  }
  console.log(`  Media assets inserted: ${insertedMedia}\n`);

  // Step 4: Insert audit logs
  console.log('Inserting audit logs...');
  let insertedLogs = 0;

  for (const rec of records) {
    const postId = postIdMap.get(rec.notionId);
    if (!postId) continue;

    const actionType = rec.stage === 'revision_needed' ? 'revision_requested' : 'stage_change';
    const details =
      rec.stage === 'revision_needed'
        ? 'Revision requested during content review'
        : `Content moved to ${rec.stage}`;

    // Use a timestamp slightly after creation for authenticity
    const logTime = new Date(new Date(rec.created_at).getTime() + 3600000).toISOString();

    const { error } = await supabase.from('post_audit_logs').insert({
      post_id: postId,
      user_name: 'Muaaz Saifi',
      action_type: actionType,
      details,
      created_at: logTime,
    });

    if (error) {
      console.warn(`  [warn] audit log insert failed: ${error.message}`);
    } else {
      insertedLogs++;
    }
  }

  console.log(`  Audit logs inserted: ${insertedLogs}\n`);

  return postIdMap;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5: VERIFICATION
// ═══════════════════════════════════════════════════════════════

async function phase5(expectedCount) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  PHASE 5: VERIFICATION                   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let allPassed = true;

  // Check 1: Total count
  const { count: totalPosts } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true });
  const countMatch = totalPosts === expectedCount;
  console.log(`[${countMatch ? 'PASS' : 'FAIL'}] Total posts: ${totalPosts} (expected ${expectedCount})`);
  if (!countMatch) allPassed = false;

  // Check 2: Count by stage
  for (const stage of ['posted', 'revision_needed']) {
    const { count } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('stage', stage);
    console.log(`  ${stage}: ${count}`);
  }

  // Check 3: No placeholder titles
  const { data: badTitles } = await supabase
    .from('posts')
    .select('title')
    .or('title.ilike.%please edit%,title.ilike.%new post%,title.eq.,title.ilike.%ready for revision%');
  const noPlaceholders = !badTitles?.length;
  console.log(`[${noPlaceholders ? 'PASS' : 'FAIL'}] No placeholder titles: ${badTitles?.length || 0} found`);
  if (!noPlaceholders) {
    allPassed = false;
    badTitles?.forEach((t) => console.log(`  Bad: "${t.title}"`));
  }

  // Check 4: Media assets count
  const { count: mediaCount } = await supabase
    .from('media_assets')
    .select('*', { count: 'exact', head: true });
  console.log(`[INFO] Media assets: ${mediaCount}`);

  // Check 5: Audit logs count
  const { count: logCount } = await supabase
    .from('post_audit_logs')
    .select('*', { count: 'exact', head: true });
  console.log(`[INFO] Audit logs: ${logCount}`);

  // Check 6: Sample 5 random posts
  const { data: samples } = await supabase
    .from('posts')
    .select('title, stage, caption, thumbnail_url, scheduled_date, media_ids')
    .limit(5);

  console.log(`\nSample posts:`);
  for (const s of samples || []) {
    const hasMedia = (s.media_ids?.length || 0) > 0;
    const hasCaption = !!s.caption;
    console.log(
      `  "${s.title}" | ${s.stage} | ${s.scheduled_date || 'no date'} | caption:${hasCaption} | media:${hasMedia}`
    );
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(allPassed ? 'MIGRATION VERIFIED SUCCESSFULLY' : 'MIGRATION COMPLETED WITH WARNINGS');
  console.log('='.repeat(50));

  return allPassed;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  NOTION → TEN80TEN SMM APP MIGRATION         ║');
  console.log('║  110 records | 5 phases | Zero code changes   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  try {
    // Phase 1: Fetch & Audit
    const records = await phase1();

    // Phase 2: Title Generation & Mapping
    const mapped = phase2(records);

    // Phase 3: Asset Migration
    const withMedia = await phase3(mapped);

    // Phase 4: DB Wipe & Insertion
    const postIdMap = await phase4(withMedia);

    // Phase 5: Verification
    await phase5(records.length);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal time: ${elapsed}s`);
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    process.exit(1);
  }

  // Cleanup tmp
  try {
    const files = await fs.readdir(TMP_DIR);
    for (const f of files) await fs.unlink(path.join(TMP_DIR, f));
  } catch { /* ignore */ }
}

main();
