# Saved calendars

In Calendar, open the menu beside the view selectors on the right and choose Create Calendar. The same modal creates Day, Week, Month, and Timeline calendars. Enter a name and select teams, individual people, or both. Save selects the new calendar immediately.

All saved calendars appear alongside the standard modes in the highlighted right-hand dropdown, on both desktop and smaller screens. Its pencil edits the selected calendar through the same modal, including its type and membership. The editor’s menu includes Remove. The left side contains date navigation; there is no separate timeline selector or create/edit entry there. The Timeline option opens the built-in shared timeline. Its pencil opens the same Teams + Users editor, with its name and type fixed. Personal Timeline is omitted from the selector; additional timelines can be created through Create Calendar.

New calendars use Preferences.calendarViewDataList, including timelines. Existing timelines in Preferences.calendarPlusList remain visible and editable. Editing a legacy timeline keeps it in that list; changing its type moves it to calendarViewDataList while preserving its ID and members. Both preference lists are saved together for a type conversion. Failed saves restore previous local preferences and keep the editor open. Removing a saved calendar selects the standard Week view.

With the default Dynamic membership setting, selected teams expand to current members whenever a saved calendar loads, refreshes, or fetches a new date range. Explicitly selected people join that membership, with duplicates removed. Removing someone from a team removes them from that team’s contribution; an explicitly selected person remains included. Deleted users are omitted. Inactive users are omitted unless Show inactive users is enabled for the current view. Empty memberships produce an empty calendar.

The userCalendar permission applies to member selection and server-side resolution. Team-level access limits team selection to the current user’s teams and filters people using calendar access checks. Event requests continue through the standard permission-checked Activities or Timeline endpoints. Saving a calendar does not grant additional access.

# Shared Day, Week, and Month

Day shows a timed column for each active, permitted member. Columns share a vertical scroll area, with aligned time slots and all-day bands. Wider teams scroll horizontally. Shared events appear in each participant’s column. Dragging and resizing use standard calendar saves and refresh the other columns. Dragging into another person’s Day column adds that person as an attendee and saves the event’s new time in a single update. For event types without a standard users attendee field, the drop adds a collaborator when supported, otherwise it changes the assigned user. A time change applies to the event for all participants. Failed moves restore the original position. Selecting an empty slot defaults a new event to the column’s user.

Week combines members in a time grid; simultaneous events appear side by side. Drag an event onto a person’s legend button to add them as an attendee while keeping its date and time. Event types without an attendee field add a collaborator when supported; only types with neither relationship change the assigned user. Legend drop targets are outlined during dragging, with a label indicating the action. Month retains its month grid. Day events use solid entity type colors. Week and Month event labels show the person’s color in the top-left corner, with a short diagonal transition into the configured entity type color across most of the label, retaining compact initials badges in the person legend. Timeline labels use solid entity type colors. Events involving multiple selected people appear once. Event cards show title and time without attendee badges. Hovering or keyboard-focusing an event opens a tooltip with its type, times, timezone, assignee, attendees or collaborators, status, and location when available. Full details load through the normal record API and respect read access; calendar summaries remain available if the full record cannot be read. Person colors are stored locally in the browser and reused across calendars.

Select a person in the legend to show or hide their events, or use Show all and Hide all. Day removes hidden people’s columns. Week and Month keep shared events while at least one participant is visible. Visibility choices are stored per calendar in the browser and survive refreshes. Hovering or keyboard-focusing a person highlights their events and dims the rest.

# Implementation and verification

The extension provides calendar controller, page, mode-button, calendar, timeline, and editor subclasses. No core application files are changed and no resource scheduler plugin is required. The standard event editing callbacks are reused. CalendarPlus has no dependency on Odyssey.

Deploy with the extension copy/build workflow and clear the application cache to load updated metadata, templates, and client modules.

- npm run test:client
- npm run unit-tests

Client tests use framework stubs. Live UI checks cover placement and interaction of selectors, editors, and the rendered calendars.

The default Timeline reads existing sharedCalendarUserList selections automatically until a new membership selection is saved. New team and explicit-user selections are stored in Preferences.calendarPlusSharedSelection. Teams resolve their active, permitted members on every fetch, with duplicates removed. This adaptation does not create a named calendar or alter existing saved calendars.

Person drops use the standard record update API and check record edit access plus permissions for the field being changed. Meetings, Calls, and custom event types with a standard users attendee relationship append the destination person to usersIds without changing assignedUserId, existing attendee responses, contacts, or leads. An empty attendee list still adds the person; an existing attendee is not duplicated and their response is not reset. Types without that attendee field append to collaboratorsIds when they have a standard collaborators relationship to User. Existing collaborators remain and repeated drops do not duplicate them. Only types without both relationships update assignedUserId instead. A non-editable or unreadable attendee or collaborator list rejects the drop rather than changing ownership. Hidden destination people are shown after a successful drop; failed Day drops restore the source and destination calendars.

# Extension settings

In Administration, the shared Extension Settings section contains a Calendar Plus row. Its settings page provides Enable tooltip on hover and Enable color gradient in month and week mode. Both default to enabled when unset. Disabling gradients makes shared Month and Week events use solid entity colors. Day and Timeline always use solid entity colors. Tooltips apply to every event in standard and custom Month, Week, Day, and Timeline calendars, including personal calendars. Settings are system-wide and use the standard admin-only Settings save flow. The PHP module is CalendarPlus and the client module is calendar-plus.

Timeline event gap (px) controls horizontal spacing in every Timeline, from 0 to 100 pixels. The default 0 keeps adjacent event ranges on one row while genuine overlaps still stack. A value of 10 restores the original spacing. Larger gaps can create additional rows for events that are close together on screen, depending on zoom. Changes take effect when a Timeline opens or refreshes.

Tooltip delay (seconds) controls the hover/focus wait before details appear in every calendar, including Timeline. It defaults to 1 second, accepts fractional values from 0 to 60, and uses 0 for immediate display. Leaving the event before the delay elapses cancels the pending tooltip.

Attendee details include accepted (✓), declined (✕), and tentative or no-answer (?) indicators. Hovering a symbol exposes the exact response status; accessible labels distinguish tentative from no answer. Users, contacts, and leads remain listed regardless of response. Custom event types using standard attendee status columns are supported; relationships without attendance statuses remain plain names.

Calendar feed limitation: EspoCRM’s standard Task calendar query selects assigned users, not collaborators. Adding a collaborator saves the relationship but does not by itself make a Task appear in the collaborator’s calendar column.

# Inactive users

The top-level calendar options menu (ellipsis beside the view selector) contains Show inactive users for saved shared views and the default shared Timeline. This checked menu option is stored in Preferences.calendarPlusViewSettings separately for each user and calendar ID, so changing a saved calendar’s type retains its choice. It defaults off and refreshes the view when toggled. It applies to the union of individually selected users and current team members for Dynamic calendars, or the captured list for Static calendars. Calendar permissions and deleted-record filtering still apply. When enabled, editing the calendar’s user selection also includes inactive internal users in search and autocomplete. It is not a membership option in the Create/Edit Calendar dialog.

# Static calendar membership

The Create/Edit Calendar dialog, including the default Timeline editor, offers Membership: Dynamic (follow team changes) or Static (capture users on save). Existing calendars remain Dynamic unless changed. Static captures the permitted union of the selected teams and people when saved, including inactive users, then stores the deduplicated user IDs alongside the original selection. Refreshes and date changes resolve only those IDs, without expanding teams again. Saving a static calendar again explicitly refreshes its captured list. Switching back to Dynamic removes the snapshot and resumes resolving teams on every fetch.

Show inactive users remains an independent per-view option. Deleted users and users no longer permitted by calendar access rules remain excluded. An empty snapshot stays empty rather than falling back to the current user or everyone. Snapshot capture failures leave the calendar unchanged, and static calendars support up to 500 captured members.


Calendar view settings are available from **… → Settings** and saved separately for each user and view. The modal includes **Show inactive users** for shared calendars and **Show weekends** for all views, including Timeline. Day and Week also offer **5, 10, 15, or 30 minute slots** and **Scroll to hour** (00:00–23:00), initially using the user's existing calendar preferences. Week and Month offer a personal gradient toggle when the administrator permits gradients. All views offer a personal tooltip toggle when the administrator permits tooltips. Administrator feature switches always take priority. Save applies changes immediately; Cancel leaves stored preferences unchanged.

- Limit visible hours in Day, Week, and Timeline with **Show from** and **Show until** in view Settings (for example, 08:00–15:00). Defaults to the full day. Shared Day columns use the same range; events outside it are hidden from the timed grid, and all-day events remain visible.

Timeline uses a repeating daily hidden interval for the visible-hour range, compressing the overnight gaps. It can be combined with hidden weekends. These options change the display, not event dates or durations.


Additional per-view settings:
- Event text size: Small, Medium (existing size), or Large.
- Timeline day boundary contrast: Subtle (existing style), Strong, or Black.
- Show declined events: on by default. Turning this off hides events where the signed-in user's attendee response is Declined. Canceled event status alone does not hide an event. When response details are unavailable due to permissions, the event stays visible. Details use the existing cache with up to four concurrent requests.
- Remember hidden people: on by default for shared Day, Week, and Month. When off, person filters still work for the open calendar but reset when the view is reopened.
- Tooltip detail switches: attendees (including task collaborators), assignee, location, and status can each be hidden. Times and the event title remain visible. Administrator tooltip restrictions still apply.
- Timeline row spacing: Compact, Comfortable (existing spacing), or Spacious. This changes vertical spacing independently of the administrator's horizontal event gap.

- **Show canceled events** is a separate per-view switch under **People and Events**, enabled by default. It uses each entity type's configured canceled statuses across all calendar modes. Completed events and declined attendee responses are handled separately.

- Declined invitations remain visible with canceled-style faded colors and a red strikethrough. This reflects the signed-in user's response, independently of other attendees and the event's canceled status. The Show declined events switch can still hide them.


- Search accessible calendar records using the magnifying glass beside Refresh in every calendar view. Filter by an inclusive date range, event types, title, assigned user, user/contact/lead attendees, and event status. Date searches include events overlapping the range, all-day items, and tasks with only a start or due date. Results show times, type, ownership, participants, and status with native record links and a **Show in calendar** action. Search defaults to the displayed month and loads more results on demand. It uses normal record permissions; calendar membership stays unchanged when navigating to a result. The calendar action is enabled only when a matching event user is already loaded; selecting it temporarily reveals the result across display filters without changing saved preferences.

Search uses the global **List Size** (`recordsPerPage`) setting, consistent with standalone list modals. Each Load more adds that many combined results across event types, preserving descending date order; it does not multiply the visible page size by the number of types.

Search results have a gear for personal column and sort options. Event title and Show in calendar remain available; optional columns include dates, assigned user, attendees, and status. Event type appears as a small entity-colored badge below the title. The initial list shows event title, dates, status, and the calendar action. Sort by date (descending by default) or title in either direction. Choices are remembered per user across calendars, and changing them reloads the search using the selected order.

The Show in calendar button ignores event-type, status, legend visibility, weekend, and time-window filters when deciding availability. It is disabled, with an explanatory title, if the event has no date or no corresponding loaded calendar user. Selecting an eligible result highlights it and can add a read-only search preview when the normal feed filters it out; it never loads extra users or changes saved filters.

- Warn before creating an event that the current calendar will not display because its users are excluded or hidden, or its event type/status is filtered. The advisory banner updates when assignees, attendees, status, or event type changes. It respects Espo's automatic owner-as-attendee setting and Task ownership rules. Saving remains available, with a warning notice after successful creation; calendar membership and filters are never changed automatically.

Quick Add uses the same live creation warning when a main calendar is currently visible. It detects the active calendar from its connected, visible view, skips unrelated record types and existing records, and leaves Quick Add unchanged on other pages. Successful Quick Add creation refreshes that calendar and shows an explanatory notice if the event will not appear. Native create forms and permissions are retained.

Creation warnings and search navigation share the same loaded-user, assignment, and attendee membership resolver. Creation additionally predicts Espo's automatic owner-as-attendee save hook; existing search records use their stored attendees. Search navigation continues to ignore display filters, while creation warnings explain when those filters would hide a newly saved event. Visibility checks do not change attendee or assignee lists.
