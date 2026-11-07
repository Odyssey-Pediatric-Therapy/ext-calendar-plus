<link href="{{basePath}}client/custom/modules/calendar-plus/css/calendar.css" rel="stylesheet">
<link href="{{basePath}}client/custom/modules/calendar-plus/css/calendar-header.css" rel="stylesheet">

{{#if header}}
<div class="row button-container calendar-plus-header">
    <div class="date-title">
    <h4><span style="cursor: pointer;" data-action="refresh" title="{{translate 'Refresh'}}"></span></h4></div>

    <div class="cp-calendar-toolbar">
        <div class="cp-calendar-navigation btn-group range-switch-group">
                <button class="btn btn-text btn-icon" data-action="refresh" title="{{translate 'Refresh'}}" aria-label="{{translate 'Refresh'}}"><span class="fas fa-sync-alt" aria-hidden="true"></span></button>
                <button class="btn btn-text btn-icon" data-action="searchCalendar" title="{{translate 'Search calendar' scope='Calendar'}}" aria-label="{{translate 'Search calendar' scope='Calendar'}}"><span class="fas fa-search" aria-hidden="true"></span></button>
                <button class="btn btn-text btn-icon" data-action="prev"><span class="fas fa-chevron-left"></span></button>
                <button class="btn btn-text btn-icon" data-action="next"><span class="fas fa-chevron-right"></span></button>
            <button class="btn btn-text btn-icon" data-action="today" title="{{translate 'Today' scope='Calendar'}}" aria-label="{{translate 'Today' scope='Calendar'}}">
                <span class="fas fa-calendar-day" aria-hidden="true"></span>
            </button>
        </div>
        <div class="cp-calendar-options mode-buttons">
            {{{modeButtons}}}
        </div>
    </div>
</div>
{{/if}}

<div class="calendar"></div>
