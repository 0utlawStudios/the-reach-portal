-- 0027_support_center.sql
-- Support Center: per-user private support threads (tickets + live chat).
--
-- Adds two tables — support_threads and support_messages — backing an in-app
-- support widget. Every thread belongs to one workspace and is owned by the
-- user who opened it. RLS exposes a thread ONLY to its creator and to a
-- workspace superadmin; no other team member can read another user's support
-- conversation, in the app or on the realtime wire.
--
-- All writes are performed server-side with the service-role client (which
-- bypasses RLS), mirroring the audit_log_v2 design in 0009. There are
-- deliberately NO INSERT / UPDATE / DELETE policies for authenticated users,
-- so message authorship cannot be spoofed from a browser.
--
-- Depends on:
--   0002_tenant_model.sql   (workspaces, workspace_members)
--   0007_rls_v2.sql         (is_active_workspace_member helper)
--
-- Iron-law compliance (AGENTS.md rule 2): every row carries workspace_id NOT NULL.

-- ─── support_threads ───

create table if not exists support_threads (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  created_by             uuid references auth.users(id) on delete set null,
  created_by_email       text not null,
  created_by_name        text not null,
  kind                   text not null check (kind in ('ticket','chat')),
  subject                text,
  category               text,
  status                 text not null default 'open'
                           check (status in ('open','in_progress','resolved','closed')),
  last_message_at        timestamptz not null default now(),
  last_sender_type       text check (last_sender_type in ('user','admin','system')),
  unread_for_user        boolean not null default false,
  unread_for_admin       boolean not null default true,
  last_user_notified_at  timestamptz,
  last_admin_notified_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ─── support_messages ───

create table if not exists support_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references support_threads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sender_type  text not null check (sender_type in ('user','admin','system')),
  sender_name  text not null,
  body         text,
  attachments  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- ─── indexes ───

create index if not exists support_threads_owner_idx
  on support_threads(created_by, last_message_at desc);
create index if not exists support_threads_ws_idx
  on support_threads(workspace_id, status, last_message_at desc);
create index if not exists support_messages_thread_idx
  on support_messages(thread_id, created_at);

-- ─── row level security ───

alter table support_threads  enable row level security;
alter table support_messages enable row level security;

-- A thread is readable by its creator, or by a superadmin of its workspace.
drop policy if exists support_threads_select on support_threads;
create policy support_threads_select on support_threads for select
  using (
    is_active_workspace_member(workspace_id, null)
    and (
      created_by = auth.uid()
      or is_active_workspace_member(workspace_id, array['superadmin'])
    )
  );

-- A message is readable exactly when its parent thread is readable.
drop policy if exists support_messages_select on support_messages;
create policy support_messages_select on support_messages for select
  using (
    is_active_workspace_member(workspace_id, null)
    and exists (
      select 1 from support_threads t
      where t.id = support_messages.thread_id
        and (
          t.created_by = auth.uid()
          or is_active_workspace_member(t.workspace_id, array['superadmin'])
        )
    )
  );

-- No INSERT / UPDATE / DELETE policies for authenticated users. All writes go
-- through server routes using the service-role client, which bypasses RLS.
-- To grant a future support teammate full visibility, add their role to the
-- array['superadmin'] lists above.

-- ─── realtime ───

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'support_threads'
  ) then
    alter publication supabase_realtime add table support_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table support_messages;
  end if;
end $$;

-- REPLICA IDENTITY FULL so realtime UPDATE/DELETE payloads carry the full row.
alter table support_threads  replica identity full;
alter table support_messages replica identity full;

-- ─── storage bucket ───

-- Private bucket for ticket/chat attachments (screenshots, video). Access is
-- server-only: routes upload with the service-role client and hand the client
-- short-lived signed URLs. 25 MB per-file ceiling; images + mp4/quicktime only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  26214400,
  array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/quicktime']
)
on conflict (id) do nothing;
