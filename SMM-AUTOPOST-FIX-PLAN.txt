SMM AUTO-PUBLISHER FIX PLAN
============================
Project: Ten80Ten SMM Portal + n8n Workflow 19ReVfrrDNnJQxSv
Date: 2026-04-20
Source: Codex adversarial review + architecture analysis

This file is the single source of truth for all fixes.
Execute each section in order. Do not skip steps.


========================================
SECTION 1: REMOVE X/TWITTER FROM APP
========================================

Files to modify:
- src/lib/types.ts: Remove "x" from Platform type union and ALL_PLATFORMS array
- src/components/platform-icons.tsx: Remove Xw component and "x" entry from platformIcons record
- Verify no other files reference platform "x" (grep for it)
- Do NOT remove the database enum value if it exists (backward compat for old posts)


========================================
SECTION 2: DATABASE - VERIFY MIGRATIONS
========================================

Confirm these migrations are applied to production Supabase:
- 0010_publish_ledger.sql (publish_jobs, platform_publish_attempts, oauth_accounts, dead_letter_jobs)
- 0011_claim_publish_job.sql (claim_publish_job RPC, reclaim_expired, dead_letter function)
- 0012_scheduled_at_tstz.sql (scheduled_at timestamptz on posts, backfill from legacy columns)
- 0013_column_drift.sql (source_vault, asset_source, etc.)

Verification query:
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('publish_jobs','platform_publish_attempts','oauth_accounts','dead_letter_jobs');

Expected result: all 4 tables exist.

Verify RPC exists:
  SELECT proname FROM pg_proc WHERE proname = 'claim_publish_job';


========================================
SECTION 3: AUTO-POSTED BADGE ON CARDS
========================================

Goal: Show "AUTO-POSTED" badge on content cards ONLY when verified published by n8n.
Verified = publish_jobs entry with state 'succeeded' or 'partial' AND at least one
platform_publish_attempts row with external_post_id IS NOT NULL.

3A. src/lib/types.ts
- Add to ContentCard interface:
    publishJob?: {
      state: string;
      platformAttempts: { platform: string; state: string; externalPostId: string | null }[];
    };

3B. src/lib/pipeline-context.tsx
- Change the posts query from:
    supabase.from("posts").select("*")
  To:
    supabase.from("posts").select("*, publish_jobs(state, platform_publish_attempts(platform, state, external_post_id))")
- In dbToCard(), map the nested publish_jobs data into the publishJob field
- Handle the case where publish_jobs is null or empty array (no job for this post)

3C. src/components/content-card.tsx
- Add badge rendering logic after the existing overdue/revised badge block
- Conditions for showing badge:
    card.stage === "posted"
    AND card.publishJob exists
    AND card.publishJob.state is 'succeeded' or 'partial'
    AND card.publishJob.platformAttempts has at least one with externalPostId !== null
- Badge placement: bottom-left of thumbnail area (same slot as overdue/revised, which don't show for posted cards)
- Succeeded state: green pill (bg-emerald-600), text "AUTO-POSTED", small Bot or Zap icon
- Partial state: amber pill (bg-amber-500), text "PARTIAL", same icon
- Next to badge text: show small platform icons for each platform that has externalPostId (verified platforms only)
- Use existing PlatformIcon component with smaller size (w-2.5 h-2.5)
- Use existing Badge component from ui/badge.tsx or inline pill (match existing badge style in the card)


========================================
SECTION 4: N8N WORKFLOW REBUILD
========================================

Workflow ID: 19ReVfrrDNnJQxSv
Workflow name: Ten80Ten SMM App Auto-Publisher V2.7
Access: n8n.ten80ten.com using N8N_API_KEY from .env

4A. Fix Schedule Node
- Set minutesInterval explicitly to 5
- Rename if needed to match actual interval

4B. Replace "Get Scheduled Posts" + "Filter Due Now"
- Remove the Code node that filters in JavaScript
- Replace with Supabase query using scheduled_at column:
    SELECT * FROM posts
    WHERE stage = 'approved_scheduled'
    AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 5
- Or use the Supabase node with filterString: stage=eq.approved_scheduled&scheduled_at=lte.now()
- Add order and limit parameters

4C. Replace "Mark as Posted" with Claim Job
- Remove the current "Mark as Posted" node that sets stage=posted before publishing
- Replace with: Call claim_publish_job RPC via Supabase node or HTTP Request
- This atomically claims one job using FOR UPDATE SKIP LOCKED
- If no job returned, skip (nothing to publish)
- The claim sets state='claimed' with a 30-second expiry

4D. Fix All Publisher Nodes - Common Changes
- Remove hardcoded token constants from ALL Code nodes
- Move tokens to n8n credentials (store as environment variables or credential entries)
- Reference tokens via $credentials or $env instead of inline constants
- Remove access_token from query strings (Meta). Use Authorization header where possible
- Add structured result output: { platform, success, externalPostId, error }
- Each publisher must write its result to platform_publish_attempts table

4E. Fix Facebook Publisher
- Use n8n credential for FB_TOKEN and FB_PAGE
- Move access_token from qs to Authorization header (or body) where Meta Graph API supports it
- Validate content_type before choosing endpoint (photos vs videos vs reels)
- Handle carousel posts (multiple photos)
- Write result to platform_publish_attempts: state, external_post_id, response_payload

4F. Fix Instagram Publisher
- Use n8n credential for IG_TOKEN and IG_USER
- Remove the 150-second blocking poll inside the Code node
- Replace with n8n Wait node or shorter poll with timeout
- Fix carousel: validate all child containers before creating parent
- Fix video/reel parameters
- Write result to platform_publish_attempts

4G. Fix LinkedIn Publisher
- MIGRATE from deprecated API:
    OLD: /v2/assets?action=registerUpload + /v2/ugcPosts
    NEW: /rest/images?action=initializeUpload + /rest/posts
- Add required headers:
    LinkedIn-Version: 202411
    X-Restli-Protocol-Version: 2.0.0
- Use n8n credential for LI_TOKEN and LI_ORG
- Write result to platform_publish_attempts

4H. Add YouTube Publisher Node
- New Code node between LinkedIn and Build Audit Entry
- YouTube Data API v3 for video uploads
- Google OAuth 2.0 credential in n8n
- Upload flow: resumable upload to /upload/youtube/v3/videos
- Set snippet (title, description), status (privacyStatus: public)
- Shorts: video under 60s, add #Shorts to title
- Write result to platform_publish_attempts

4I. Add TikTok Publisher Node
- New Code node after YouTube publisher
- Content Posting API with OAuth 2.0
- Upload flow: init upload -> upload chunks -> publish
- Video only (skip if content_type is image)
- Write result to platform_publish_attempts

4J. Fix Build Audit Entry
- Replace plain text summary with structured JSON
- Include: execution ID, per-platform results with external post IDs, timestamps
- Detect overall status: all_succeeded, partial, all_failed

4K. Add Final Status Update Node (NEW - after Build Audit Entry)
- Based on aggregated results:
    All platforms succeeded -> set publish_jobs.state = 'succeeded', set posts.stage = 'posted'
    Some succeeded, some failed -> set publish_jobs.state = 'partial', set posts.stage = 'posted'
    All failed -> set publish_jobs.state = 'failed', do NOT change posts.stage
    Retry limit exceeded -> call dead_letter_publish_job() RPC
- Write publish_results to platform_publish_attempts (already done per-node above)

4L. Add Failure Alert Branch (NEW)
- After status update, if any failures occurred:
    Send notification (email, webhook, or n8n error workflow)
    Include: post title, which platforms failed, error messages
- Use n8n Error Trigger as backup for workflow-level failures

4M. Fix Log to Audit Trail
- Add Supabase credentials to the node (currently missing)
- Write structured JSON instead of plain text to details column
- Include n8n execution_id in the log entry

4N. Fix Manual Test Safety
- Add a Set node after Manual Test trigger that sets a dry_run flag
- Publisher nodes check dry_run: if true, log what would be published but don't call APIs
- Or: disconnect Manual Test from live flow, connect to a separate validation-only path

4O. Fix Media URL Handling
- Replace Google Drive uc?export=download pattern with proper handling
- Options: (a) fetch binary via Google Drive API with credentials, (b) use Supabase Storage URLs, (c) validate URL accessibility before publishing
- At minimum: check HTTP response before passing URL to platform APIs

4P. Update Sticky Notes
- Update all 3 sticky notes to reflect the new architecture
- Remove references to pasting tokens in Code nodes
- Document the new state machine flow
- Document the credential setup process


========================================
SECTION 5: TOKEN STORAGE IN N8N
========================================

Create these n8n credential entries (not in Code nodes):

5A. Meta (Facebook + Instagram)
- Type: Header Auth or Generic Credential
- Name: "Meta System User Token"
- Values: access_token, page_id, ig_user_id
- Source: System User token from Business Manager (never expires)

5B. LinkedIn
- Type: OAuth2 or Generic Credential
- Name: "LinkedIn OAuth"
- Values: access_token, refresh_token, org_id
- Source: 3-legged OAuth flow
- Note: Token expires in 60 days. Build a refresh reminder workflow.

5C. YouTube (Google)
- Type: Google OAuth2
- Name: "YouTube Upload"
- Values: handled by n8n Google OAuth2 credential type
- Scopes: youtube.upload, youtube.force-ssl
- Source: Google Cloud Console OAuth client

5D. TikTok
- Type: Generic Credential or Header Auth
- Name: "TikTok Content API"
- Values: access_token, refresh_token, open_id, client_key, client_secret
- Source: TikTok developer portal OAuth flow
- Note: Access token expires in 24 hours. Auto-refresh via refresh_token (365 days).

5E. Supabase (already exists but not applied)
- Apply existing Supabase credential to ALL Supabase nodes in the workflow
- Nodes missing credentials: Get Scheduled Posts, Mark as Posted, Log to Audit Trail


========================================
SECTION 6: PUBLISH JOB CREATION
========================================

The workflow consumes publish_jobs but something must CREATE them.
Two options:

Option A: n8n creates the job
- After claiming due posts in section 4B, create a publish_jobs row with state='pending'
- Then immediately claim it
- Simple but couples job creation to the publisher

Option B: SMM Portal creates the job (preferred)
- When a post moves to approved_scheduled with a scheduled_at date, the portal creates a publish_jobs row
- The n8n workflow only claims and processes existing jobs
- Add this to pipeline-context.tsx moveCard() function:
    If newStage === 'approved_scheduled' and post has scheduled_at:
      Insert into publish_jobs (workspace_id, post_id, scheduled_at, state='pending')
- Add this logic server-side (API route) to avoid RLS issues with client-side inserts


========================================
SECTION 7: TOKEN REFRESH WORKFLOWS
========================================

Build separate n8n workflows for token maintenance:

7A. LinkedIn Token Refresh
- Schedule: run daily
- Check token expiry date
- If within 10 days of expiry: send alert email/notification
- If refresh_token available (partner access): auto-refresh
- If not: send re-authorization link to admin

7B. TikTok Token Refresh
- Schedule: run every 12 hours
- Auto-refresh using refresh_token
- Store new access_token back to credential/env
- Alert if refresh_token is within 30 days of expiry

7C. YouTube Token Refresh
- Handled automatically by n8n's Google OAuth2 credential type
- No separate workflow needed


========================================
SECTION 8: VERIFICATION CHECKLIST
========================================

After all fixes are applied, verify each item:

[ ] X/Twitter removed from Platform type and icons
[ ] All 4 publish tables exist in Supabase
[ ] claim_publish_job RPC exists and works
[ ] Content card shows AUTO-POSTED badge for verified posts
[ ] Content card shows NO badge for manually-moved posted cards
[ ] Content card shows PARTIAL badge for partially-posted cards
[ ] n8n workflow uses claim_publish_job instead of direct stage update
[ ] All tokens stored in n8n credentials, zero tokens in Code nodes
[ ] LinkedIn uses /rest/posts API with version header
[ ] Facebook uses Authorization header, not query string token
[ ] Instagram poll is not blocking for 150 seconds
[ ] YouTube publisher node exists and handles video/shorts
[ ] TikTok publisher node exists and handles video
[ ] Failure alert fires when platform publish fails
[ ] Manual test does not publish to live platforms
[ ] Schedule interval is explicitly 5 minutes
[ ] Structured audit logs written to post_audit_logs
[ ] publish_jobs state reflects actual publish outcome
[ ] platform_publish_attempts has external_post_id for each success
[ ] Supabase credentials applied to all Supabase nodes
[ ] Media URLs validated before passing to platform APIs
[ ] Sticky notes updated to reflect new architecture


========================================
EXECUTION ORDER
========================================

Phase 1 (no tokens needed):
  - Section 1: Remove X/Twitter
  - Section 2: Verify database migrations
  - Section 3: Build AUTO-POSTED badge
  - Section 6: Publish job creation logic

Phase 2 (tokens needed):
  - Section 5: Store tokens in n8n credentials
  - Section 4: Rebuild n8n workflow

Phase 3 (after workflow is live):
  - Section 7: Token refresh workflows
  - Section 8: Full verification pass


END OF FIX PLAN
