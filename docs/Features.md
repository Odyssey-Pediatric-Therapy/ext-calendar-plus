# Calendar Plus features

- See everyone’s schedule together. Combine teams and individual people in one shared calendar.
- Choose the right perspective. Switch between Day, Week, Month, and Timeline from one calendar selector.
- Create and edit every calendar type in one place. Save dedicated views for departments, projects, or cross-team coordination.
- Find a common meeting time in the existing Meeting and Call scheduler. Next available searches forward for a slot that fits everyone, preserves the event duration, and updates the unsaved times.
- Compare availability side by side. Shared Day gives each person an aligned column with time slots and all-day events.
- Add people directly from the calendar. Drop into another person’s Day column or onto their Week legend entry to add them as an attendee. If there is no attendee field, add them as a collaborator when supported; reassign only when neither relationship exists. Day drops can also reschedule the event; Week legend drops keep its time.
- Preserve ownership and attendee responses. Adding an attendee or collaborator keeps the assigned user, existing participants, and their response statuses unchanged, and avoids duplicate participants.
- Focus on the people who matter. Instantly show or hide individual schedules, with visibility remembered per calendar in the browser.
- Spot someone’s events quickly. Hover over or keyboard-focus their legend entry to highlight their schedule.
- Recognize people and activity types. Stable person colors, initials, and optional Month/Week gradients provide visual cues. Day and Timeline use solid entity colors.
- Keep event cards readable. Short events use a compact layout, with titles contained inside their cards instead of spilling into nearby time slots.
- Preview details in every calendar. Modern hover and keyboard-focus tooltips show event type, times, timezone, assignee, status, location, and participants when available, including in Timeline.
- See attendee responses at a glance. Attendee chips show ✓ for accepted, ✕ for declined, and ? for tentative or no answer. Hovering an indicator reveals the exact status.
- Show meaningful task details. Task tooltips list actual collaborators when available, without a redundant calendar-user list.
- Control tooltip timing. Set a system-wide delay, defaulting to 1 second, with fractional seconds or immediate display supported. Disabling tooltips hides the delay field while retaining its value.
- Keep Timeline rows compact. Back-to-back event ranges share a row by default while genuine overlaps still stack. Configure horizontal spacing from 0 to 100 pixels; 10 restores the original gap.
- Schedule in smaller increments. Choose 5-, 10-, 15-, or 30-minute slots, with subtle dotted lines between solid hour markers in Day and Week views.
- Refresh from any view. A refresh control is available across calendar types.
- Keep team calendars current. Dynamic membership resolves whenever calendars fetch events, including refreshes and date changes, with duplicates removed and deleted users excluded. Inactive users are hidden by default.
- Manage extension options centrally. Admin → Extension Settings → Calendar Plus controls tooltips, tooltip delay, Month/Week gradients, and Timeline spacing.
- Respect existing CRM permissions. Calendar Plus uses EspoCRM’s access controls and standard event records, and retains existing saved calendar definitions.

- Include inactive team members when needed. Use Show inactive users in the calendar’s top-level options menu; the choice is saved per view and per user, including the default Timeline. Dynamic calendars continue resolving current team members; static calendars use their captured list. Calendar permissions still apply.

- Keep a fixed calendar roster. Choose Static membership in a calendar’s configuration to capture its team members and individually selected users when saved. Later team changes do not alter the roster; save again to refresh it, or switch back to Dynamic. The inactive-user visibility option remains independent.


Calendar view settings are available from the **Edit Calendar** pencil beside the calendar selector and saved separately for each user and view. Custom calendar editors combine the name, calendar type, teams, users, membership behavior, and view settings in one form. Built-in Month, Week, and Day calendars open their relevant view settings; the default Timeline combines membership and Timeline settings. The modal includes **Show inactive users** for shared calendars and **Show weekends** for all views, including Timeline. Day and Week also offer **5, 10, 15, or 30 minute slots** and **Scroll to hour** (00:00–23:00), initially using the user's existing calendar preferences. Week and Month offer a personal gradient toggle when the administrator permits gradients. All views offer a personal tooltip toggle when the administrator permits tooltips. Administrator feature switches always take priority. Save applies changes immediately; Cancel leaves stored preferences unchanged.

- Limit visible hours in Day, Week, and Timeline with **Show from** and **Show until** in the calendar editor (for example, 08:00–15:00). Defaults to the full day. Shared Day columns use the same range; events outside it are hidden from the timed grid, and all-day events remain visible.

Timeline uses a repeating daily hidden interval for the visible-hour range, compressing the overnight gaps. It can be combined with hidden weekends. These options change the display, not event dates or durations.


Additional per-view settings:
- Event text size: Small, Medium (existing size), or Large.
- Timeline day boundary contrast: Subtle (existing style), Strong, or Black.
- Show declined events: on by default. Turning this off hides events where the signed-in user's attendee response is Declined. Canceled event status alone does not hide an event. When response details are unavailable due to permissions, the event stays visible. Details use the existing cache with up to four concurrent requests.
- Remember hidden people: on by default for shared Day, Week, and Month. When off, person filters still work for the open calendar but reset when the view is reopened.
- Tooltip detail switches: attendees (including task collaborators), assignee, location, and status can each be hidden. Times and the event title remain visible. Administrator tooltip restrictions still apply.
- Timeline row spacing: Compact, Comfortable (existing spacing), or Spacious. This changes vertical spacing independently of the administrator's horizontal event gap.

- **Show completed events** is a separate per-view switch under **People and Events**, enabled by default. Turning it off hides statuses listed in each event type's `completedStatusList`, including custom types.

- **Show canceled events** is a separate per-view switch under **People and Events**, enabled by default. It uses each entity type's configured canceled statuses across all calendar modes. Completed events and declined attendee responses are handled separately.

- Declined invitations remain visible with canceled-style faded colors and a red strikethrough. This reflects the signed-in user's response, independently of other attendees and the event's canceled status. The Show declined events switch can still hide them.


- Search accessible calendar records using the magnifying glass beside Refresh in every calendar view. Filter by an inclusive date range, event types, title, assigned user, user/contact/lead attendees, and event status. Date searches include events overlapping the range, all-day items, and tasks with only a start or due date. Results show times, type, ownership, participants, and status with native record links and a **Show in calendar** action. Search defaults to the displayed month and loads more results on demand. It uses normal record permissions; calendar membership stays unchanged when navigating to a result. The calendar action is enabled only when a matching event user is already loaded; selecting it temporarily reveals the result across display filters without changing saved preferences.

Search uses the global **List Size** (`recordsPerPage`) setting, consistent with standalone list modals. Each Load more adds that many combined results across event types, preserving descending date order; it does not multiply the visible page size by the number of types.

Search results have a gear for personal column and sort options. Event title and Show in calendar remain available; optional columns include dates, assigned user, attendees, and status. Event type appears as a small entity-colored badge below the title. The initial list shows event title, dates, status, and the calendar action. Sort by date (descending by default) or title in either direction. Choices are remembered per user across calendars, and changing them reloads the search using the selected order.

The Show in calendar button ignores event-type, status, legend visibility, weekend, and time-window filters when deciding availability. It is disabled, with an explanatory title, if the event has no date or no corresponding loaded calendar user. Selecting an eligible result highlights it and can add a read-only search preview when the normal feed filters it out; it never loads extra users or changes saved filters.

- Warn before creating an event that the current calendar will not display because its users are excluded or hidden, or its event type/status is filtered. The advisory banner updates when assignees, attendees, status, or event type changes. It respects Espo's automatic owner-as-attendee setting and Task ownership rules. Saving remains available, with a warning notice after successful creation; calendar membership and filters are never changed automatically.

Quick Add uses the same live creation warning when a main calendar is currently visible. It detects the active calendar from its connected, visible view, skips unrelated record types and existing records, and leaves Quick Add unchanged on other pages. Successful Quick Add creation refreshes that calendar and shows an explanatory notice if the event will not appear. Native create forms and permissions are retained.


- **Print calendar** in the options menu opens a PDF preview of the current visible calendar, including its date range, event colors, and visible-user legend. It supports standard and shared Month/Week/Day calendars and Timeline. The PDF preserves the current viewport and filters; scroll to the part of the calendar you want before printing. Portrait or landscape A4 is chosen to fit the view. If the browser blocks preview tabs, the PDF downloads instead. pdf-lib and html2canvas are bundled locally and loaded only when printing.
