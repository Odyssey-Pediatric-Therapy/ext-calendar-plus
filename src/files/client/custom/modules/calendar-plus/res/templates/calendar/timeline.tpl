<link href="{{basePath}}client/custom/modules/calendar-plus/css/calendar.css" rel="stylesheet">

<link href="{{basePath}}client/modules/crm/css/vis.css" rel="stylesheet">

{{#if header}}
<div class="row button-container calendar-plus-header">
    <div class="col-sm-4 col-xs-12">
        <div class="btn-group">
            <button
                class="btn btn-text btn-icon"
                title="{{translate 'Refresh'}}"
                data-action="refresh"
            ><span class="fas fa-sync-alt"></span></button>
            <button
                class="btn btn-text"
                data-action="today"
            >{{translate 'Today' scope='Calendar'}}</button>
        </div>
    </div>

    <div class="date-title col-sm-4 hidden-xs">
    <h4><span style="cursor: pointer;" data-action="refresh" title="{{translate 'Refresh'}}"></span></h4></div>

    <div class="col-sm-4 col-xs-12">
        <div class="btn-group pull-right mode-buttons">
            {{{modeButtons}}}
        </div>
    </div>
</div>
{{/if}}

<div class="timeline cp-calendar-timeline"></div>
