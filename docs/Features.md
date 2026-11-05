# Calendar Plus features

- See everyone’s schedule together. Combine teams and individual people in one shared calendar.
- Choose the right perspective. Switch between Day, Week, Month, and Timeline from one calendar selector.
- Create and edit every calendar type in one place. Save dedicated views for departments, projects, or cross-team coordination.
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
