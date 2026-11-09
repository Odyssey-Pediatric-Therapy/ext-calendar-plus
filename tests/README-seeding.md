# Manual calendar fixtures

These scripts follow the manual seed/empty workflow in `ext-more-date-filters`. They live entirely in this repository's `tests` directory and are excluded from extension packages. Faker is installed automatically when missing; Composer must be available on PATH.

## Generate events

By default, generate only events for the site's existing active internal users, including admins. Existing users, teams, memberships, roles, passwords, calendar selections, and preferences remain unchanged.

```sh
npm run seed -- --dry-run
npm run seed
```

The existing `admin` user is always included, regardless of `--generate-users`. Its account, password, roles, and memberships remain unchanged. The dry run reads existing users and teams but writes no records. API, portal, system, inactive, and deleted users are excluded.

For every selected person, the script generates a random 4–8 events on every weekday from six calendar months ago through six months from now. Counts vary independently for each person and day; totals vary each run. With 15 users this produces around 23,000 events. Month-end dates clamp to the last valid day of the target month.

Schedules include Tasks, Meetings, and Calls with different times, durations, some deliberate overlaps, past completed events, canceled events, attendee acceptance states, and some task collaborators. Faker supplies readable people and company names for event titles. Events are assigned to the selected person and inherit their teams. Meetings and Calls include another selected person when available.

`--events-per-day` sets the maximum daily count (8 by default); each person's daily count is drawn independently from 4 through that maximum. The repository site's timezone determines local working hours; stored timestamps use UTC. `--start-time` and `--end-time` default to `0800` and `1800`. Both accept `HHmm` or `HH:mm`; starts and ends stay inside this daily window. The end must be later than the start; `2400` is allowed as the end of the day. `--timezone` overrides the local timezone and respects its daylight-saving changes.

```sh
npm run seed -- --events-per-day=10
npm run seed -- --start-time=0800 --end-time=1800
npm run seed -- --start-time=09:30 --end-time=15:00 --timezone=America/Denver
npm run seed -- --timezone=America/Denver
npm run seed -- --run-id=customercheck --dry-run
npm run seed -- --help
```

## Optionally generate users and teams

Use `--generate-users` to create new people and teams along with their events:

```sh
npm run seed -- --generate-users
npm run seed -- --generate-users --users=20 --teams=6
npm run seed -- --generate-users --dry-run
```

This mode creates 15 active Faker-named users and five realistically named teams by default, with varied sizes and overlapping memberships. `--users` (15–300) and `--teams` (2–100) apply only with this flag. Events are generated for these new users and the existing `admin` user. This mode also creates a role allowing shared-calendar access and access to the generated event types.

New usernames follow `cp_demo_<run-id>_<number>`. Only these new users receive the password `CalendarDemo!2026`; set `CALENDAR_PLUS_SEED_PASSWORD` to replace it. Use these credentials only in a test/development installation. Existing users' passwords remain unchanged.

The dry run reads the existing `admin` account but writes no records. Select the new teams or users in a calendar's configuration to see their schedules after seeding.

Both modes append a new batch. Inserts and relationships run in one transaction, bypassing hooks, notifications, reminders, stream updates, and workflows. Cleanup IDs and generated relationships are saved under the ignored `tests/.fixtures/` directory before committing. Keep these manifests until cleanup is complete.

## Empty calendars

`npm run empty` clears only **Task, Meeting, and Call** tables in this repository's site, including non-generated and soft-deleted events. Users, teams, roles, passwords, and memberships are unchanged.

```sh
npm run empty -- --dry-run
npm run empty
```

To also delete non-admin users, all teams, and all roles, pass `--users` explicitly. Admin, super-admin, and Espo's internal system accounts are always preserved.

```sh
npm run empty -- --users --dry-run
npm run empty -- --users
```

Cleanup is transactional and bypasses hooks. Event-only cleanup retains the user/team/role entries and membership links in local seed manifests for later cleanup with `--users`.

Pass npm arguments after `--`. These manual scripts always target this repository's `site/`; an alternate site cannot be specified, and a `site` symlink to another installation is rejected. The existing `npm run test:seed` and `npm run test:system` commands continue using their separate, deterministic automated-test database and fixtures.
