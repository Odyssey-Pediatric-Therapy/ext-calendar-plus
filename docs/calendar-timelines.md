# Saved calendars

In Calendar, open the menu beside the view selectors on the right and choose Create Calendar. The same modal creates Day, Week, Month, and Timeline calendars. Enter a name and select teams, individual people, or both. Save selects the new calendar immediately.

All saved calendars appear alongside the standard modes in the highlighted right-hand dropdown, on both desktop and smaller screens. Its pencil edits the selected calendar through the same modal, including its type and membership. The editor’s menu includes Remove. The left side contains date navigation; there is no separate timeline selector or create/edit entry there. The Timeline option opens the built-in shared timeline. Its pencil opens the same Teams + Users editor, with its name and type fixed. Personal Timeline is omitted from the selector; additional timelines can be created through Create Calendar.

New calendars use Preferences.calendarViewDataList, including timelines. Existing timelines in Preferences.calendarPlusList remain visible and editable. Editing a legacy timeline keeps it in that list; changing its type moves it to calendarViewDataList while preserving its ID and members. Both preference lists are saved together for a type conversion. Failed saves restore previous local preferences and keep the editor open. Removing a saved calendar selects the standard Week view.

Selected teams expand to current active members whenever a saved calendar loads, refreshes, or fetches a new date range. Explicitly selected people join that membership, with duplicates removed. Removing someone from a team removes them from that team’s contribution; an explicitly selected person remains included. Inactive or deleted users are omitted. Empty memberships produce an empty calendar.

The userCalendar permission applies to member selection and server-side resolution. Team-level access limits team selection to the current user’s teams and filters people using calendar access checks. Event requests continue through the standard permission-checked Activities or Timeline endpoints. Saving a calendar does not grant additional access.

# Shared Day, Week, and Month

Day shows a timed column for each active, permitted member. Columns share a vertical scroll area, with aligned time slots and all-day bands. Wider teams scroll horizontally. Shared events appear in each participant’s column. Dragging and resizing use standard calendar saves and refresh the other columns. Dragging into another person’s Day column reassigns the event and saves its new time in a single update. Failed moves restore the original position. Selecting an empty slot defaults a new event to the column’s user.

Week combines members in a time grid; simultaneous events appear side by side. Drag an event onto a person’s legend button to reassign it while keeping its date and time. Legend drop targets are outlined during dragging. Month retains its month grid. Day events use solid entity type colors. Week and Month event labels show the person’s color in the top-left corner, with a short diagonal transition into the configured entity type color across most of the label, retaining compact initials badges in the person legend. Timeline labels use solid entity type colors. Events involving multiple selected people appear once. Event cards show title and time without attendee badges. Hovering or keyboard-focusing an event opens a tooltip with its type, times, timezone, assignee, attendees or collaborators, status, and location when available. Full details load through the normal record API and respect read access; calendar summaries remain available if the full record cannot be read. Person colors are stored locally in the browser and reused across calendars.

Select a person in the legend to show or hide their events, or use Show all and Hide all. Day removes hidden people’s columns. Week and Month keep shared events while at least one participant is visible. Visibility choices are stored per calendar in the browser and survive refreshes. Hovering or keyboard-focusing a person highlights their events and dims the rest.

# Implementation and verification

The extension provides calendar controller, page, mode-button, calendar, timeline, and editor subclasses. No core application files are changed and no resource scheduler plugin is required. The standard event editing callbacks are reused. CalendarPlus has no dependency on Odyssey.

Deploy with the extension copy/build workflow and clear the application cache to load updated metadata, templates, and client modules.

- npm run test:client
- npm run unit-tests

Client tests use framework stubs. Live UI checks cover placement and interaction of selectors, editors, and the rendered calendars.

The default Timeline reads existing sharedCalendarUserList selections automatically until a new membership selection is saved. New team and explicit-user selections are stored in Preferences.calendarPlusSharedSelection. Teams resolve their active, permitted members on every fetch, with duplicates removed. This adaptation does not create a named calendar or alter existing saved calendars.

Reassignment uses the standard record update API and checks edit access and field permissions. It changes assignedUserId without sending attendee relationship fields. The previous assigned user remains an attendee only if already listed; reassignment does not add them. Existing attendee memberships are preserved. Hidden recipients are shown after a successful drop.

# Extension settings

In Administration, the shared Extension Settings section contains a Calendar Plus row. Its settings page provides Enable tooltip on hover and Enable color gradient in month and week mode. Both default to enabled when unset. Disabling gradients makes shared Month and Week events use solid entity colors. Day and Timeline always use solid entity colors. Tooltips apply to every event in standard and custom Month, Week, Day, and Timeline calendars, including personal calendars. Settings are system-wide and use the standard admin-only Settings save flow. The PHP module is CalendarPlus and the client module is calendar-plus.
