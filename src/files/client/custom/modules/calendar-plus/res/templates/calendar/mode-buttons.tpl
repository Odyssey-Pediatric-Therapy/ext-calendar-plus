<div class="btn-group cp-calendar-picker" role="group">
    <button type="button" class="btn btn-primary dropdown-toggle" data-toggle="dropdown" title="{{selectedModeLabel}}" aria-haspopup="true">
        <span class="cp-calendar-picker-label">{{selectedModeLabel}}</span> <span class="caret"></span>
    </button>
    <ul class="dropdown-menu pull-right">
        {{#each allModeDataList}}
        {{#if separatorBefore}}<li class="divider" role="separator"></li>{{/if}}
        <li><a role="button" tabindex="0" class="{{#ifEqual mode ../mode}}active{{/ifEqual}}" data-action="mode" data-mode="{{mode}}"{{#ifEqual mode ../mode}} aria-current="page"{{/ifEqual}}>
            {{#ifEqual mode ../mode}}<span class="fas fa-check pull-right" aria-hidden="true"></span>{{/ifEqual}}{{label}}
        </a></li>
        {{/each}}
    </ul>
</div>
<div class="btn-group" role="group">
    <button type="button" class="btn btn-text dropdown-toggle" data-toggle="dropdown"><span class="fas fa-ellipsis-h"></span></button>
    <ul class="dropdown-menu pull-right">
        {{#each scopeFilterDataList}}
            <li>
                <a
                    role="button"
                    tabindex="0"
                    data-action="toggleScopeFilter"
                    data-name="{{scope}}"
                >
                    <span class="fas fa-check filter-check-icon check-icon pull-right{{#if disabled}} hidden{{/if}}"></span>
                    <div>{{translate scope category='scopeNamesPlural'}}</div>

                </a>
            </li>
        {{/each}}
        {{#if hasMoreItems}}
            <li class="divider"></li>
        {{/if}}
        {{#if calendarEditable}}
            <li><a role="button" tabindex="0" data-action="editCustomView">{{translate 'Edit Calendar' scope='Calendar'}}</a></li>
        {{/if}}
        {{#if isCustomViewAvailable}}
            <li>
                <a
                    role="button"
                    tabindex="0"
                    data-action="createCustomView"
                >{{translate 'Create Calendar' scope='Calendar'}}</a>
            </li>
        {{/if}}
        {{#if hasWorkingTimeCalendarLink}}
            <li>
                <a href="#WorkingTimeCalendar">{{translate 'WorkingTimeCalendar' category='scopeNamesPlural'}}</a>
            </li>
        {{/if}}
    </ul>
</div>
