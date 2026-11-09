The system tests run entirely from this repository. They install the built extension ZIP into an ignored runtime under `tests/.runtime/site`, using read-only Espo core files from the repository's `site/` directory. No changes are made to `build.js`.

Prerequisites: `npm install`, a prepared local `site/` with Composer dependencies, PHP with PDO MySQL and ZIP, and MySQL credentials that can create the test database. The default connection comes from the local site's config; the database defaults to `cp_calendar_plus_test`. Override with `CP_TEST_DB_HOST`, `CP_TEST_DB_PORT`, `CP_TEST_DB_USER`, `CP_TEST_DB_PASSWORD`, and `CP_TEST_DB_NAME`.

The database name must end in `_test` and differ from the local site's database. Existing databases without the test-suite ownership marker are rejected. The seed script updates only its deterministic fixture records and relationships. Do not point this setup at an existing application database.

Commands:

- `npm test`: existing client and PHP unit tests.
- `npm run test:integration`: build, prepare fixtures, and run HTTP integration tests against real Espo services and MySQL.
- `npm run test:e2e`: build, prepare fixtures, and run browser tests at desktop and mobile sizes.
- `npm run test:system`: prepare once and run both integration and browser tests.
- `npm run test:prepare`: build the extension and prepare the isolated site and fixtures.
- `npm run test:seed`: reset fixture records without rebuilding the site.
- `npm run test:serve`: open the prepared test site at `http://127.0.0.1:8878` for manual inspection.

Browser tests use installed Google Chrome on macOS when available. Otherwise run `npm run test:browsers` to install Chromium into the repository's ignored runtime. `CP_TEST_BROWSER_PATH` selects another Chromium executable. `CP_TEST_PORT` changes the server port; `CP_TEST_PHP` selects the PHP executable.

The fixture includes 15 named users across five teams with overlapping memberships, an inactive user, separate admin and restricted test accounts, and 323 meetings, calls, and tasks over the current Monday–Friday. Times and durations vary throughout the workday, with deliberate overlaps, completed/canceled events, and attendee acceptance states. Four saved calendars cover month, week, day, and timeline. Stable IDs make reseeding repeatable; dates roll forward with the current week.

The ignored `tests/.runtime/fixtures.json` records IDs, dates, and fixture credentials. The default test login is `cp_admin` / `CalendarPlusTest!2026`; override the password using `CP_TEST_PASSWORD` when preparing or seeding. These credentials belong only to the isolated test site.

API tests cover authentication, calendar permissions, team expansion and ordering, inactive-user inclusion, selection validation, saved preferences, and persisted event relationships. Browser tests exercise installed extension loading, view switching with real events, and the search dialog on desktop and mobile. They complement the existing unit tests; they do not guarantee every calendar feature. Failed browser tests retain screenshots and traces in `test-results/`.
