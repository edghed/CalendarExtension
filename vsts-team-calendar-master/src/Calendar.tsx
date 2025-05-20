import "./Calendar.scss";

import * as React from "react";
import * as ReactDOM from "react-dom";

import { CommonServiceIds, IProjectPageService, getClient } from "azure-devops-extension-api";
import { IExtensionDataService, IExtensionDataManager, ILocationService, IHostNavigationService } from "azure-devops-extension-api/Common";
import { CoreRestClient, WebApiTeam } from "azure-devops-extension-api/Core";
import { TeamMember } from "azure-devops-extension-api/WebApi/WebApi";

import * as SDK from "azure-devops-extension-sdk";

import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { CustomHeader, HeaderTitleArea } from "azure-devops-ui/Header";
import { IHeaderCommandBarItem, HeaderCommandBar } from "azure-devops-ui/HeaderCommandBar";
import { Icon } from "azure-devops-ui/Icon";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { ContextualMenu } from "azure-devops-ui/Menu";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { Observer } from "azure-devops-ui/Observer";
import { Page } from "azure-devops-ui/Page";
import { Location } from "azure-devops-ui/Utilities/Position";

import { View, EventApi, Duration, Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";

import { localeData } from "moment";

import { AddEditDaysOffDialog } from "./AddEditDaysOffDialog";
import { AddEditEventDialog } from "./AddEditEventDialog";
import { ICalendarEvent } from "./Contracts";

import { FreeFormId, FreeFormEventsSource } from "./FreeFormEventSource";
import { SummaryComponent } from "./SummaryComponent";


import { MonthAndYear, monthAndYearToString,shiftToUTC, shiftToLocal,formatDate } from "./TimeLib";
import { DaysOffId, VSOCapacityEventSource, IterationId } from "./VSOCapacityEventSource";
import { RemoteId, RemoteEventSource } from "./RemoteEventSource";
import { AddEditRemoteDialog } from "./AddEditRemoteDialog";
const EXTENSION_VERSION = "2.0.140";


enum Dialogs {
    None,
    NewEventDialog,
    NewDaysOffDialog,
    NewTrainingDialog,
    NewRemoteDialog
}

class ExtensionContent extends React.Component {
    remoteEventSource: RemoteEventSource;

    
    anchorElement: ObservableValue<HTMLElement | undefined> = new ObservableValue<HTMLElement | undefined>(undefined);
    calendarComponentRef = React.createRef<FullCalendar>();
    commandBarItems: IHeaderCommandBarItem[];
    currentMonthAndYear: ObservableValue<MonthAndYear>;
    dataManager: IExtensionDataManager | undefined;
    displayCalendar: ObservableValue<boolean>;
    eventApi?: EventApi;
    eventToEdit?: ICalendarEvent;
    freeFormEventSource: FreeFormEventsSource;
    hostUrl: string;
    members: TeamMember[];
    navigationService: IHostNavigationService | undefined;
    openDialog: ObservableValue<Dialogs> = new ObservableValue(Dialogs.None);
    projectId: string;
    projectName: string;
    selectedEndDate: Date;
    selectedStartDate: Date;
    selectedTeamName: string;
    showMonthPicker: ObservableValue<boolean> = new ObservableValue<boolean>(false);
    teams: ObservableValue<WebApiTeam[]>;
    vsoCapacityEventSource: VSOCapacityEventSource;

    constructor(props: {}) {
        super(props);

        this.currentMonthAndYear = new ObservableValue<MonthAndYear>({
            month: new Date().getMonth(),
            year: new Date().getFullYear()
        });
        this.remoteEventSource = new RemoteEventSource();

        this.state = {
            fullScreenMode: false,
            calendarWeekends: true,
            calendarEvents: []
        };

        this.commandBarItems = [
            {
                iconProps: {
                    iconName: "Add"
                },
                id: "newItem",
                important: true,
                onActivate: this.onClickNewItem,
                text: "New Item"
            },
            {
                id: "today",
                important: true,
                onActivate: () => {
                    if (this.calendarComponentRef.current) {
                        this.getCalendarApi().today();
                        this.currentMonthAndYear.value = {
                            month: new Date().getMonth(),
                            year: new Date().getFullYear()
                        };
                    }
                },
                text: "Today"
            },
            {
                iconProps: {
                    iconName: "ChevronLeft"
                },
                important: true,
                id: "prev",
                onActivate: () => {
                    if (this.calendarComponentRef.current) {
                        this.getCalendarApi().prev();
                        this.currentMonthAndYear.value = this.calcMonths(this.currentMonthAndYear.value, -1);
                    }
                },
                text: "Prev"
            },
            {
                iconProps: {
                    iconName: "ChevronRight"
                },
                important: true,
                id: "next",
                onActivate: () => {
                    if (this.calendarComponentRef.current) {
                        this.getCalendarApi().next();
                        this.currentMonthAndYear.value = this.calcMonths(this.currentMonthAndYear.value, 1);
                    }
                },
                text: "Next"
            }
        ];

        this.selectedEndDate = new Date();
        this.selectedStartDate = new Date();
        this.teams = new ObservableValue<WebApiTeam[]>([]);
        this.selectedTeamName = "Select Team";
        this.displayCalendar = new ObservableValue<boolean>(false);
        this.projectId = "";
        this.projectName = "";
        this.hostUrl = "";
        this.members = [];
        this.freeFormEventSource = new FreeFormEventsSource();
        this.vsoCapacityEventSource = new VSOCapacityEventSource();
    }

    public render(): JSX.Element {
        return (
            <Page className="flex-grow flex-row">
                <div className="flex-column scroll-hidden calendar-area">
                    <CustomHeader className="bolt-header-with-commandbar">
                        <HeaderTitleArea className="flex-grow">
                            <div className="flex-grow">
                                <Observer currentMonthAndYear={this.currentMonthAndYear}>
                                    {(props: { currentMonthAndYear: MonthAndYear }) => {
                                        return (
                                            <Dropdown
                                                items={this.getMonthPickerOptions()}
                                                key={props.currentMonthAndYear.month}
                                                onSelect={this.onSelectMonthYear}
                                                placeholder={monthAndYearToString(props.currentMonthAndYear)}
                                                renderExpandable={expandableProps => (
                                                    <DropdownExpandableButton hideDropdownIcon={true} {...expandableProps} />
                                                )}
                                                width={200}
                                            />
                                        );
                                    }}
                                </Observer>
                                <Icon ariaLabel="Video icon" iconName="ChevronRight" />
                                <Observer teams={this.teams}>
                                    {(props: { teams: WebApiTeam[] }) => {
                                        return props.teams.length === 0 ? null : (

                                            <Dropdown
                                                items={this.getTeamPickerOptions()}
                                                onSelect={this.onSelectTeam}
                                                placeholder={this.selectedTeamName}
                                                renderExpandable={expandableProps => <DropdownExpandableButton {...expandableProps} />}
                                                width={200}
                                            />
                                        );
                                    }}
                                </Observer>
                            </div>
                        </HeaderTitleArea>
                        <HeaderCommandBar items={this.commandBarItems} />
                    </CustomHeader>
                    <Observer display={this.displayCalendar}>
                        {(props: { display: boolean }) => {
                            return props.display ? (
                                <div className="calendar-component">
                                    <FullCalendar
                                        defaultView="dayGridMonth"

                                       // defaultView="dayGridMonth"
                                        editable={true}
                                        eventClick={this.onEventClick}
                                        eventDrop={this.onEventDrop}
                                        eventRender={this.eventRender}
                                        eventResize={this.onEventResize}
                                        eventSources={[
                                            { events: this.freeFormEventSource.getEvents },
                                            { events: this.vsoCapacityEventSource.getEvents },
                                             { events: this.remoteEventSource.getEvents }

                                        ]}
                                        firstDay={localeData(navigator.language).firstDayOfWeek()}
                                        header={false}
                                        height={this.getCalendarHeight()}
                                        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                                        ref={this.calendarComponentRef}
                                        select={this.onSelectCalendarDates}
                                        selectable={true}
                                    />
                                </div>
                            ) : null;
                        }}
                    </Observer>
                </div>
                <SummaryComponent capacityEventSource={this.vsoCapacityEventSource} freeFormEventSource={this.freeFormEventSource}  remoteEventSource={this.remoteEventSource} />
                <Observer anchorElement={this.anchorElement}>
                    {(props: { anchorElement: HTMLElement | undefined }) => {
                        return props.anchorElement ? (
                            <ContextualMenu
                                anchorElement={props.anchorElement}
                                anchorOffset={{ horizontal: 4, vertical: 4 }}
                                anchorOrigin={{ horizontal: Location.start, vertical: Location.start }}
                                key={this.selectedEndDate!.toString()}
                                menuProps={{
                                    id: "calendar-context-menu",
                                    items: [
                                        { id: "event", text: "Add Training", iconProps: { iconName: "Education" }, onActivate: this.onClickAddTraining }
,
                                        { id: "dayOff", text: "Add OOO", iconProps: { iconName: "Clock" }, onActivate: this.onClickAddDaysOff },
                                        { id: "remote", text: "Add Remote", iconProps: { iconName: "Home" }, onActivate: this.onClickAddRemote }
                                    ]
                                }}
                                
                                onDismiss={() => {
                                    this.anchorElement.value = undefined;
                                }}
                            />
                        ) : null;
                    }}
                </Observer>
                <Observer dialog={this.openDialog}>
    {(props: { dialog: Dialogs }) => {
        switch (props.dialog) {
            case Dialogs.NewDaysOffDialog:
                return (
                    <AddEditDaysOffDialog
                        calendarApi={this.getCalendarApi()}
                        end={this.selectedEndDate}
                        event={this.eventToEdit}
                        eventSource={this.vsoCapacityEventSource}
                        members={this.members}
                        onDismiss={this.onDialogDismiss}
                        start={this.selectedStartDate}
                        dialogTitle="Out of Office"
                    />
                );

            case Dialogs.NewEventDialog:
                return (
                    <AddEditEventDialog
                        calendarApi={this.getCalendarApi()}
                        end={this.selectedEndDate}
                        eventApi={this.eventApi}
                        eventSource={this.freeFormEventSource}
                        onDismiss={this.onDialogDismiss}
                        start={this.selectedStartDate}
                        dialogTitle="Event"
                    />
                );

            case Dialogs.NewTrainingDialog:
                return (
                    <AddEditEventDialog
                        calendarApi={this.getCalendarApi()}
                        end={this.selectedEndDate}
                        eventApi={this.eventApi}
                        eventSource={this.freeFormEventSource}
                        onDismiss={this.onDialogDismiss}
                        start={this.selectedStartDate}
                        dialogTitle="Training"
                    />
                );
                case Dialogs.NewRemoteDialog:
    return (
        <AddEditRemoteDialog
        calendarApi={this.getCalendarApi()}
        start={this.selectedStartDate}
        end={this.selectedEndDate}
        members={this.members}
        event={this.eventToEdit}
        onDismiss={this.onDialogDismiss}
        dialogTitle="Remote"
        eventSource={this.remoteEventSource}
            
        />
    );


            default:
                return null;
        }
    }}
</Observer>

            </Page>
        );
    }

    componentDidMount() {
        SDK.init();
        this.initialize();
        const shouldRefresh = localStorage.getItem("forceCalendarRefresh") === "true";
if (shouldRefresh) {
    setTimeout(() => {
        if (this.calendarComponentRef.current) {
           // console.log(" Refetch automatique post-reset");
            this.getCalendarApi().refetchEvents();
            localStorage.removeItem("forceCalendarRefresh");
        }
    }, 200); //  Donne à React le temps de monter le calendrier
}

        window.addEventListener("resize", this.updateDimensions);
    }

    private calcMonths(current: MonthAndYear, monthDelta: number): MonthAndYear {
        let month = (current.month + monthDelta) % 12;
        let year = current.year + Math.floor((current.month + monthDelta) / 12);
        if (month < 0) {
            month = 12 + month;
        }
        return { month, year };
    }
    private onClickAddRemote = () => {
        this.eventToEdit = undefined;
    
        // Ne rien faire si les dates sont déjà définies par le clic sur le calendrier
        if (!this.selectedStartDate || !this.selectedEndDate) {
            const today = new Date();
            this.selectedStartDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            this.selectedEndDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        }
    
        this.openDialog.value = Dialogs.NewRemoteDialog;
    };
    
    

    /**
     * Edits the rendered event if required
     */
    private eventRender = (arg: {
        isMirror: boolean;
        isStart: boolean;
        isEnd: boolean;
        event: EventApi;
        el: HTMLElement;
        view: View;
    }) => {
        const { event, el } = arg;
        const halfDay: "AM" | "PM" | undefined = event.extendedProps?.halfDay;
    
        // Style AM/PM
        if (halfDay === "AM" || halfDay === "PM") {
            const bgColor = halfDay === "AM" ? "#FFF3E0" : "#E3F2FD";
            const borderColor = halfDay === "AM" ? "#FB8C00" : "#1976D2";
    
            el.style.backgroundColor = bgColor;
            el.style.borderLeft = `4px solid ${borderColor}`;
    
            let content = el.querySelector(".fc-event-title") as HTMLElement | null;
            if (!content) {
                content = document.createElement("div");
                content.className = "fc-event-title";
                content.style.fontSize = "0.8em";
                el.appendChild(content);
            }
    
            if (!content.textContent?.startsWith(`[${halfDay}]`)) {
                const current = content.textContent || "";
                content.textContent = `[${halfDay}] ${current}`.trim();
            }
        }
    
        // DAYS OFF AVATARS (ne pas modifier)
        if (event.id.startsWith(DaysOffId) && event.start) {
            const normalizedDate = shiftToUTC(event.start as Date);
            normalizedDate.setUTCHours(0, 0, 0, 0);
    
            const capacityEvent = this.vsoCapacityEventSource.getGroupedEventForDate(normalizedDate);
            if (capacityEvent?.icons?.length) {
                const content = el.querySelector(".fc-content") || el;
    
                // Clear old icons
                content.querySelectorAll(".event-icon").forEach(i => i.remove());
    
                capacityEvent.icons.forEach(icon => {
                    const linkedId = icon.linkedEvent.id;
                    const currentId = event.extendedProps?.id;
    
                    if (linkedId === currentId && icon.src) {
                        const img = document.createElement("img");
                        img.src = icon.src;
                        img.className = "event-icon";
                        img.title = icon.linkedEvent.title;
                        img.style.height = "14px";
                        img.style.marginLeft = "6px";
                        img.style.borderRadius = "50%";
                        img.style.cursor = "pointer";
    
                        img.onclick = e => {
                            e.stopPropagation(); // évite propagation
                            this.eventToEdit = icon.linkedEvent;
                            this.openDialog.value = Dialogs.NewDaysOffDialog;
                        };
    
                        content.appendChild(img);
                    }
                });
            }
        }
    
        // ✅ REMOTE AVATAR (corrigé pour éviter l'accès à .eventMap)
        else if (event.id.startsWith(RemoteId) && arg.isStart) {
            const memberId = event.extendedProps?.member?.id;
            const rawStart = new Date(event.extendedProps?.startDate ?? event.start!);
            rawStart.setUTCHours(0, 0, 0, 0);
    
            const grouped = this.remoteEventSource.getGroupedEventForDate(rawStart);
            const fullEvent = grouped?.icons?.find(icon =>
                icon.linkedEvent.member?.id === memberId &&
                new Date(icon.linkedEvent.startDate).getTime() === new Date(event.extendedProps?.startDate).getTime() &&
                icon.linkedEvent.halfDay === event.extendedProps?.halfDay
            )?.linkedEvent;
    
            if (memberId && fullEvent) {
                const content = el.querySelector(".fc-content") || el;
                content.querySelectorAll(".event-icon").forEach(i => i.remove());
    
                const img = document.createElement("img");
                img.src = `${this.hostUrl}/_apis/GraphProfile/MemberAvatars/${memberId}?size=small`;
                img.className = "event-icon";
                img.title = "Remote";
                img.style.height = "14px";
                img.style.marginLeft = "6px";
                img.style.borderRadius = "50%";
                img.style.cursor = "pointer";
    
                img.onclick = e => {
                    e.stopPropagation();
                    this.eventToEdit = fullEvent;
                    this.openDialog.value = Dialogs.NewRemoteDialog;
                };
    
                content.appendChild(img);
            }
        }
    
        // ITERATION rendering (inchangé)
        else if (event.id.startsWith(IterationId) && arg.isStart) {
            el.innerText = event.title;
            el.style.color = "black";
        }
    };
    
    
    
    

    private getCalendarApi(): Calendar {
        return this.calendarComponentRef.current!.getApi();
    }

    /**
     * Manually calculates available vertical space for calendar
     */
    private getCalendarHeight(): number {
        var height = document.getElementById("team-calendar");
        if (height) {
            return height.offsetHeight - 90;
        }
        return 200;
    }

    private getMonthPickerOptions(): IListBoxItem[] {
        const options: IListBoxItem[] = [];
        const listSize = 3;
        for (let i = -listSize; i <= listSize; ++i) {
            const monthAndYear = this.calcMonths(this.currentMonthAndYear.value, i);
            const text = monthAndYearToString(monthAndYear);
            options.push({
                data: monthAndYear,
                id: text,
                text: text
            });
        }
        return options;
    }

    private getTeamPickerOptions(): IListBoxItem[] {
        const options: IListBoxItem[] = [];
        this.teams.value.forEach(function(item) {
            options.push({ data: item, id: item.id, text: item.name });
        });

        return options;
    }

    private async initialize() {
        const dataSvc = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectService.getProject();
        const locationService = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);

        this.dataManager = await dataSvc.getExtensionDataManager(SDK.getExtensionContext().id, await SDK.getAccessToken());
        this.vsoCapacityEventSource.setDataManager(this.dataManager);

        this.navigationService = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);

        const queryParam = await this.navigationService.getQueryParams();
        let selectedTeamId;

        // if URL has team id in it, use that
        if (queryParam && queryParam["team"]) {
            selectedTeamId = queryParam["team"];
        }

        if (project) {
            if (!selectedTeamId) {
                // Nothing in URL - check data service
                selectedTeamId = await this.dataManager.getValue<string>("selected-team-" + project.id, { scopeType: "User" });
            }

            const client = getClient(CoreRestClient);

            const allTeams = [];
            let teams;
            let callCount = 0;
            const fetchCount = 1000;
            do {
                teams = await client.getTeams(project.id, false, fetchCount, callCount * fetchCount);
                allTeams.push(...teams);
                callCount++;
            } while (teams.length === fetchCount);

            this.projectId = project.id;
            this.projectName = project.name;

            allTeams.sort((a, b) => {
                return a.name.toUpperCase().localeCompare(b.name.toUpperCase());
            });

            // if team id wasn't in URL or database use first available team
            if (!selectedTeamId) {
                selectedTeamId = allTeams[0].id;
            }

            if (!queryParam || !queryParam["team"]) {
                // Add team id to URL
                this.navigationService.setQueryParams({ team: selectedTeamId });
            }

            this.hostUrl = await locationService.getServiceLocation();
            try {
                this.selectedTeamName = (await client.getTeam(project.id, selectedTeamId)).name;
            } catch (error) {
                console.error(`Failed to get team with ID ${selectedTeamId}: ${error}`);
              
                
            }
            this.freeFormEventSource.initialize(selectedTeamId, this.dataManager);
            this.remoteEventSource.initialize(
                project.id,
                project.name,
                selectedTeamId,
                this.selectedTeamName,
                this.hostUrl,
                this.dataManager
            );
            

            this.vsoCapacityEventSource.initialize(project.id, this.projectName, selectedTeamId, this.selectedTeamName, this.hostUrl);
            //  Reset automatique après déploiement si version a changé
const resetKey = `last-init-version-${project.id}`;
const lastKnownVersion = await this.dataManager!.getValue<string>(resetKey, { scopeType: "User" }).catch(() => undefined);

if (lastKnownVersion !== EXTENSION_VERSION) {
   // console.log(` Nouvelle version détectée (${lastKnownVersion} → ${EXTENSION_VERSION})`);

   
    
    // Reset les deux sources
    this.vsoCapacityEventSource.resetAllState();
    await this.freeFormEventSource.clearStoredEvents();

    localStorage.setItem("forceCalendarRefresh", "true"); //  flag temporaire
    await this.dataManager!.setValue(resetKey, EXTENSION_VERSION, { scopeType: "User" });
}




            if (queryParam?.reset === "true") {
                this.vsoCapacityEventSource.resetAllState();
                this.getCalendarApi().refetchEvents();
            }
            
            this.displayCalendar.value = true;
            this.dataManager.setValue<string>("selected-team-" + project.id, selectedTeamId, { scopeType: "User" });
            this.teams.value = allTeams;
            this.members = await client.getTeamMembersWithExtendedProperties(project.id, selectedTeamId);
        }
    }

    private onClickNewItem = () => {
        this.eventApi = undefined;
        const today = new Date();
        this.selectedStartDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        this.selectedEndDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (this.calendarComponentRef.current) {
            this.openDialog.value = Dialogs.NewEventDialog;
        }
    };

    private onClickAddEvent = () => {
        this.eventApi = undefined;
        this.openDialog.value = Dialogs.NewEventDialog;
    };
   
     private onClickAddTraining = () => {
        this.eventApi = undefined;
        this.openDialog.value = Dialogs.NewTrainingDialog;
    };

    private onClickAddDaysOff = () => {
        this.eventToEdit = undefined;
        this.openDialog.value = Dialogs.NewDaysOffDialog;
    };
    

    private onDialogDismiss = () => {
        this.openDialog.value = Dialogs.None;
        
        if (this.calendarComponentRef.current) {
            this.getCalendarApi().refetchEvents();
        }
    };
    

    private onEventClick = (arg: { el: HTMLElement; event: EventApi; jsEvent: MouseEvent; view: View }) => {
        const { event } = arg;
    
        if (event.id.startsWith(FreeFormId)) {
            this.eventApi = event;
            this.openDialog.value = Dialogs.NewEventDialog;
            return;
        }
    
        if (event.id.startsWith(RemoteId)) {
            const rawStart = new Date(event.extendedProps?.startDate ?? event.start!);
            rawStart.setUTCHours(0, 0, 0, 0);
            const grouped = this.remoteEventSource.getGroupedEventForDate(rawStart);
    
            if (grouped?.icons?.length) {
                const exact = grouped.icons.find(icon =>
                    icon.linkedEvent.member?.id === event.extendedProps?.member?.id &&
                    new Date(icon.linkedEvent.startDate).getTime() === new Date(event.extendedProps?.startDate).getTime() &&
                    icon.linkedEvent.halfDay === event.extendedProps?.halfDay
                );
    
                if (exact) {
                    this.eventToEdit = exact.linkedEvent;
                    this.openDialog.value = Dialogs.NewRemoteDialog;
                }
            }
    
            return;
        }
    
        if (event.id.startsWith(DaysOffId)) {
            const rawStart = new Date(event.extendedProps?.startDate ?? event.start!);
            rawStart.setUTCHours(0, 0, 0, 0);
            const grouped = this.vsoCapacityEventSource.getGroupedEventForDate(rawStart);
    
            if (grouped?.icons?.length) {
                const exact = grouped.icons.find(icon =>
                    icon.linkedEvent.member?.id === event.extendedProps?.member?.id &&
                    new Date(icon.linkedEvent.startDate).getTime() === new Date(event.extendedProps?.startDate).getTime() &&
                    icon.linkedEvent.halfDay === event.extendedProps?.halfDay
                );
    
                if (exact) {
                    this.eventToEdit = exact.linkedEvent;
                    this.openDialog.value = Dialogs.NewDaysOffDialog;
                }
            }
        }
    };
    
    

    private onEventDrop = (arg: {
        el: HTMLElement;
        event: EventApi;
        oldEvent: EventApi;
        delta: Duration;
        revert: () => void;
        jsEvent: Event;
        view: View;
    }) => {
        if (arg.event.id.startsWith(FreeFormId)) {
            let inclusiveEndDate;
            if (arg.event.end) {
                inclusiveEndDate = new Date(arg.event.end);
                inclusiveEndDate.setDate(arg.event.end.getDate() - 1);
            } else {
                inclusiveEndDate = new Date(arg.event.start!);
            }

            this.freeFormEventSource.updateEvent(
                arg.event.extendedProps.id,
                arg.event.title,
                arg.event.start!,
                inclusiveEndDate,
             
                arg.event.extendedProps.description,
                arg.event.extendedProps.halfDay,
                
            );
        }
    };

    private onEventResize = (arg: {
        el: HTMLElement;
        startDelta: Duration;
        endDelta: Duration;
        prevEvent: EventApi;
        event: EventApi;
        revert: () => void;
        jsEvent: Event;
        view: View;
    }) => {
        if (arg.event.id.startsWith(FreeFormId)) {
            let inclusiveEndDate;
            if (arg.event.end) {
                inclusiveEndDate = new Date(arg.event.end);
                inclusiveEndDate.setDate(arg.event.end.getDate() - 1);
            } else {
                inclusiveEndDate = new Date(arg.event.start!);
            }

            this.freeFormEventSource.updateEvent(
                arg.event.extendedProps.id,
                arg.event.title,
                arg.event.start!,
                inclusiveEndDate,
              
                arg.event.extendedProps.description,
                arg.event.extendedProps.halfDay
            );
        }
    };

   /* private onSelectCalendarDates = (arg: {
        start: Date;
        end: Date;
        startStr: string;
        endStr: string;
        allDay: boolean;
        resource?: any;
        jsEvent: MouseEvent;
        view: View;
    }) => {
        this.selectedEndDate = new Date(arg.end);
        this.selectedEndDate.setDate(arg.end.getDate() - 1);
        this.selectedStartDate = arg.start;
        const dataDate = formatDate(this.selectedEndDate, "YYYY-MM-DD");
        this.anchorElement.value = document.querySelector("[data-date='" + dataDate + "']") as HTMLElement;
    };*/
    private onSelectCalendarDates = (arg: {
        start: Date;
        end: Date;
        startStr: string;
        endStr: string;
        allDay: boolean;
        resource?: any;
        jsEvent: MouseEvent;
        view: View;
    }) => {
      //  console.log(" [Select] Raw start:", arg.start.toISOString());
      //  console.log(" [Select] Raw end:", arg.end.toISOString());
    
        this.selectedEndDate = new Date(arg.end);
        this.selectedEndDate.setDate(arg.end.getDate() - 1);
        this.selectedStartDate = arg.start;
    
      //  console.log(" [Select] Adjusted start:", this.selectedStartDate.toISOString());
      //  console.log(" [Select] Adjusted end:", this.selectedEndDate.toISOString());
    
        const dataDate = formatDate(this.selectedEndDate, "YYYY-MM-DD");
        this.anchorElement.value = document.querySelector("[data-date='" + dataDate + "']") as HTMLElement;
    };
    

    private onSelectMonthYear = (event: React.SyntheticEvent<HTMLElement, Event>, item: IListBoxItem<{}>) => {
        const date = item.data as MonthAndYear;
        if (this.calendarComponentRef) {
            this.getCalendarApi().gotoDate(new Date(date.year, date.month));
            this.currentMonthAndYear.value = date;
        }
    };

    private onSelectTeam = async (event: React.SyntheticEvent<HTMLElement, Event>, item: IListBoxItem<{}>) => {
        const newTeam = item.data! as WebApiTeam;
        this.selectedTeamName = newTeam.name;
        this.freeFormEventSource.initialize(newTeam.id, this.dataManager!);
        this.vsoCapacityEventSource.initialize(this.projectId, this.projectName, newTeam.id, newTeam.name, this.hostUrl);
        this.getCalendarApi().refetchEvents();
        this.dataManager!.setValue<string>("selected-team-" + this.projectId, newTeam.id, { scopeType: "User" });
        this.navigationService!.setQueryParams({ team: newTeam.id });
        this.members = await getClient(CoreRestClient).getTeamMembersWithExtendedProperties(this.projectId, newTeam.id);
    };

    private updateDimensions = () => {
        if (this.calendarComponentRef.current) {
            this.calendarComponentRef.current.getApi().setOption("height", this.getCalendarHeight());
        }
    };
}

function showRootComponent(component: React.ReactElement<any>) {
    ReactDOM.render(component, document.getElementById("team-calendar"));
}

showRootComponent(<ExtensionContent />);
