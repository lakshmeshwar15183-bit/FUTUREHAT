-- Lumixo — harden polls UPDATE (0062 opened creator UPDATE for close/anonymous).
-- Prevent IDOR-style reassignment: conversation_id / created_by / content freeze.
-- Only closes_at and anonymous may change after create.

create or replace function public.guard_poll_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.id is distinct from OLD.id then
    raise exception 'poll id immutable';
  end if;
  if NEW.conversation_id is distinct from OLD.conversation_id then
    raise exception 'poll conversation immutable';
  end if;
  if NEW.created_by is distinct from OLD.created_by then
    raise exception 'poll creator immutable';
  end if;
  if NEW.question is distinct from OLD.question
     or NEW.options is distinct from OLD.options
     or NEW.multiple is distinct from OLD.multiple then
    raise exception 'poll content immutable after create';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'poll created_at immutable';
  end if;
  -- Once closed, do not reopen (prevents race reopening closed polls).
  if OLD.closes_at is not null
     and (NEW.closes_at is null or NEW.closes_at > OLD.closes_at) then
    raise exception 'closed poll cannot be reopened';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_poll_update on public.polls;
create trigger trg_guard_poll_update
  before update on public.polls
  for each row execute function public.guard_poll_update();

revoke all on function public.guard_poll_update() from public;
grant execute on function public.guard_poll_update() to postgres, service_role;

comment on function public.guard_poll_update() is
  'Freeze poll identity/content; only closes_at + anonymous may change (0062 close/anon).';
