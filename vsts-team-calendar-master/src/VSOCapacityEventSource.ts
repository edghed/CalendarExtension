import { getClient } from "azure-devops-extension-api";
import { TeamContext } from "azure-devops-extension-api/Core";
import { ObservableValue, ObservableArray } from "azure-devops-ui/Core/Observable";
import { EventInput } from "@fullcalendar/core";
import { EventSourceError } from "@fullcalendar/core/structs/event-source";
import { generateColor } from "./Color";
import { IDaysOffGroupedEvent } from './IDaysOffGroupedEvent'; 
import { ICalendarEvent, IEventIcon, IEventCategory, ICalendarMember } from "./Contracts";
import { formatDate, getDatesInRange, shiftToUTC, shiftToLocal } from "./TimeLib";
import { TeamMemberCapacityIdentityRef, TeamSettingsIteration, TeamSettingsDaysOff, TeamSettingsDaysOffPatch, CapacityPatch, TeamMemberCapacity, WorkRestClient } from "azure-devops-extension-api/Work";


export const DaysOffId = "daysOff";
export const Everyone = "Everyone";
export const IterationId = "iteration";

export class VSOCapacityEventSource {
    private capacityMap: { [iterationId: string]: { [memberId: string]: TeamMemberCapacityIdentityRef } } = {};
    private capacitySummaryData: ObservableArray<IEventCategory> = new ObservableArray<IEventCategory>([]);
    private capacityUrl: ObservableValue<string> = new ObservableValue("");
    //private groupedEventMap: { [dateString: string]: ICalendarEvent } = {};
    private customEventsMap: { [eventKey: string]: { halfDay?: "AM" | "PM" } } = {};
    private hostUrl: string = "";
    private iterations: TeamSettingsIteration[] = [];
    private iterationSummaryData: ObservableArray<IEventCategory> = new ObservableArray<IEventCategory>([]);
    private iterationUrl: ObservableValue<string> = new ObservableValue("");
    private teamContext: TeamContext = { projectId: "", teamId: "", project: "", team: "" };
    private teamDayOffMap: { [iterationId: string]: TeamSettingsDaysOff } = {};
    private workClient: WorkRestClient = getClient(WorkRestClient, {});
    private groupedEventMap: { [date: string]: IDaysOffGroupedEvent } = {};  // Regroupement des événements

    

    /**
     * Add new day off for a member or a team
     */
    public addEvent = (
        iterationId: string,
        startDate: Date,
        endDate: Date,
        isHalfDay: boolean,
        memberName: string,
        memberId: string,
        halfDayType?: "AM" | "PM"
    ) => {
        const isTeam = memberName === Everyone;
        startDate = shiftToUTC(startDate);
        endDate = shiftToUTC(endDate);
        if (isHalfDay && halfDayType) {
            if (halfDayType === "AM") {
                startDate.setUTCHours(9, 0, 0, 0);
                endDate.setUTCHours(12, 0, 0, 0);
            } else {
                startDate.setUTCHours(14, 0, 0, 0);
                endDate.setUTCHours(18, 0, 0, 0);
            }
            console.log("🧪 addEvent", { startDate, endDate, isHalfDay, halfDayType });

        }
        
    
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            delete this.teamDayOffMap[iterationId];
            const teamDaysOffPatch: TeamSettingsDaysOffPatch = { daysOff: teamDaysOff.daysOff };
            teamDaysOffPatch.daysOff.push({ end: endDate, start: startDate });
            return this.workClient.updateTeamDaysOff(teamDaysOffPatch, this.teamContext, iterationId);
        } else {
            const capacity =
                this.capacityMap[iterationId] && this.capacityMap[iterationId][memberId]
                    ? this.capacityMap[iterationId][memberId]
                    : {
                        activities: [
                            {
                                capacityPerDay: 0,
                                name: ""
                            }
                        ],
                        daysOff: []
                    };
            delete this.capacityMap[iterationId];
            const capacityPatch: CapacityPatch = { activities: capacity.activities, daysOff: capacity.daysOff };
            
            const sameDayIndex = capacityPatch.daysOff.findIndex(d =>
                new Date(d.start).toDateString() === startDate.toDateString()
            );
            
            if (sameDayIndex >= 0) {
                const existing = capacityPatch.daysOff[sameDayIndex];
                existing.start = new Date(Math.min(existing.start.getTime(), startDate.getTime()));
                existing.end = new Date(Math.max(existing.end.getTime(), endDate.getTime()));
            } else {
                capacityPatch.daysOff.push({ start: startDate, end: endDate });
            }
            
            const eventKey = `${memberId}_${startDate.toISOString()}`;
            this.customEventsMap[eventKey] = {
            halfDay: halfDayType
               };
            return this.workClient.updateCapacityWithIdentityRef(capacityPatch, this.teamContext, iterationId, memberId);
            
        }
    };
    
   

    /**
     *Delete day off for a member or a team
     */
     public deleteEvent = (event: ICalendarEvent, iterationId: string) => {
        const isTeam = event.member!.displayName === Everyone;
        const startDate = shiftToUTC(new Date(event.startDate));
        const endDate = shiftToUTC(new Date(event.endDate));
    
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            delete this.teamDayOffMap[iterationId];
            teamDaysOff.daysOff = teamDaysOff.daysOff.filter(
                d => !(d.start.valueOf() === startDate.valueOf() && d.end.valueOf() === endDate.valueOf())
            );
            const teamDaysOffPatch: TeamSettingsDaysOffPatch = { daysOff: teamDaysOff.daysOff };
            return this.workClient.updateTeamDaysOff(teamDaysOffPatch, this.teamContext, iterationId);
        } else {
            const capacity = this.capacityMap[iterationId][event.member!.id];
            delete this.capacityMap[iterationId];
            capacity.daysOff = capacity.daysOff.filter(
                d => !(d.start.valueOf() === startDate.valueOf() && d.end.valueOf() === endDate.valueOf())
            );
            const capacityPatch: CapacityPatch = { activities: capacity.activities, daysOff: capacity.daysOff };
            return this.workClient.updateCapacityWithIdentityRef(capacityPatch, this.teamContext, iterationId, event.member!.id);
        }
    };
    
    
    public getCapacitySummaryData = (): ObservableArray<IEventCategory> => {
        return this.capacitySummaryData;
    };

    public getCapacityUrl = (): ObservableValue<string> => {
        return this.capacityUrl;
    };

    public getEvents = (
        arg: {
            start: Date;
            end: Date;
            timeZone: string;
        },
        successCallback: (events: EventInput[]) => void,
        failureCallback: (error: EventSourceError) => void
    ): void | PromiseLike<EventInput[]> => {
        const capacityPromises: PromiseLike<TeamMemberCapacity[]>[] = [];
        const teamDaysOffPromises: PromiseLike<TeamSettingsDaysOff>[] = [];
        const renderedEvents: EventInput[] = [];
        const capacityCatagoryMap: { [id: string]: IEventCategory } = {};
        const currentIterations: IEventCategory[] = [];

        this.groupedEventMap = {};

        this.fetchIterations().then(iterations => {
            if (!iterations) {
                iterations = [];
            }
            this.iterations = iterations;

            // convert end date to inclusive end date
            const calendarStart = arg.start;
            const calendarEnd = new Date(arg.end);
            calendarEnd.setDate(arg.end.getDate() - 1);

            for (const iteration of iterations) {
                let loadIterationData = false;

                if (iteration.attributes.startDate && iteration.attributes.finishDate) {
                    const iterationStart = shiftToLocal(iteration.attributes.startDate);
                    const iterationEnd = shiftToLocal(iteration.attributes.finishDate);

                    const exclusiveIterationEndDate = new Date(iterationEnd);
                    exclusiveIterationEndDate.setDate(iterationEnd.getDate() + 1);

                    if (
                        (calendarStart <= iterationStart && iterationStart <= calendarEnd) ||
                        (calendarStart <= iterationEnd && iterationEnd <= calendarEnd) ||
                        (iterationStart <= calendarStart && iterationEnd >= calendarEnd)
                    ) {
                        loadIterationData = true;

                        const now = new Date();
                        let color;
                        if (iteration.attributes.startDate <= now && now <= iteration.attributes.finishDate) {
                            color = generateColor("currentIteration");
                        } else {
                            color = generateColor("otherIteration");
                        }

                        renderedEvents.push({
                            allDay: true,
                            backgroundColor: color,
                            end: exclusiveIterationEndDate,
                            id: IterationId + iteration.name,
                            rendering: "background",
                            start: iterationStart,
                            textColor: "#FFFFFF",
                            title: iteration.name
                        });

                        currentIterations.push({
                            color: color,
                            eventCount: 1,
                            subTitle: formatDate(iterationStart, "MONTH-DD") + " - " + formatDate(iterationEnd, "MONTH-DD"),
                            title: iteration.name
                        });
                    }
                } else {
                    loadIterationData = true;
                }

                if (loadIterationData) {
                    const teamsDayOffPromise = this.fetchTeamDaysOff(iteration.id);
                    teamDaysOffPromises.push(teamsDayOffPromise);
                    teamsDayOffPromise.then((teamDaysOff: TeamSettingsDaysOff) => {
                        this.processTeamDaysOff(teamDaysOff, iteration.id, capacityCatagoryMap, calendarStart, calendarEnd);
                    });

                    const capacityPromise = this.fetchCapacities(iteration.id);
                    capacityPromises.push(capacityPromise);
                    capacityPromise.then((capacities: TeamMemberCapacityIdentityRef[]) => {
                        this.processCapacity(capacities, iteration.id, capacityCatagoryMap, calendarStart, calendarEnd);
                    });
                }
            }

            Promise.all(teamDaysOffPromises).then(() => {
                Promise.all(capacityPromises).then(() => {
                    Object.keys(this.groupedEventMap).forEach(id => {
                        const event = this.groupedEventMap[id];
                        // skip events with date strings we can't parse.
                        const start = new Date(event.startDate);
                        const end = new Date(event.endDate);
                        if ((calendarStart <= start && start <= calendarEnd) || (calendarStart <= end && end <= calendarEnd)) {
                            renderedEvents.push({
                                allDay: !event.halfDay,
                                color: "transparent",
                                editable: false,
                                id: event.id,
                                title: "",
                            
                                start: (() => {
                                    const s = new Date(start);
                                    if (event.halfDay === "AM") {
                                        s.setHours(8, 0, 0, 0);
                                    } else if (event.halfDay === "PM") {
                                        s.setHours(13, 0, 0, 0);
                                    }
                                    return s;
                                })(),
                            
                                end: (() => {
                                    const e = new Date(start);
                                    if (event.halfDay === "AM") {
                                        e.setHours(12, 0, 0, 0);
                                    } else if (event.halfDay === "PM") {
                                        e.setHours(17, 0, 0, 0);
                                    } else {
                                        return end;
                                    }
                                    return e;
                                })()
                            });
                        }
                    });

                    successCallback(renderedEvents);
                    this.iterationSummaryData.value = currentIterations;
                    this.capacitySummaryData.value = Object.keys(capacityCatagoryMap).map(key => {
                        const catagory = capacityCatagoryMap[key];
                        if (catagory.eventCount > 1) {
                            catagory.subTitle = catagory.eventCount + " days off";
                        }
                        return catagory;
                    });
                            
                    this.capacitySummaryData.value = Object.keys(capacityCatagoryMap).map(key => {
                        const catagory = capacityCatagoryMap[key];
                        const rounded = Number(catagory.eventCount.toFixed(1)); 
                    
                        catagory.subTitle = `${rounded} day${rounded !== 1 ? "s" : ""} off`;
                        return catagory;
                    });
                    
                });
            });
        });
    };

    public getGroupedEventForDate = (date: Date): IDaysOffGroupedEvent | undefined => {
        const dateString = date.toISOString().split("T")[0]; 
        return this.groupedEventMap[dateString];
    };
    

    public getIterationForDate = (startDate: Date, endDate: Date): TeamSettingsIteration | undefined => {
        let iteration = undefined;
        startDate = shiftToUTC(startDate);
        endDate = shiftToUTC(endDate);
        this.iterations.forEach(item => {
            if (
                item.attributes.startDate <= startDate &&
                startDate <= item.attributes.finishDate &&
                item.attributes.startDate <= endDate &&
                endDate <= item.attributes.finishDate
            ) {
                iteration = item;
            }
        });

        return iteration;
    };

    public getIterationSummaryData = (): ObservableArray<IEventCategory> => {
        return this.iterationSummaryData;
    };

    public getIterationUrl = (): ObservableValue<string> => {
        return this.iterationUrl;
    };

    public initialize(projectId: string, projectName: string, teamId: string, teamName: string, hostUrl: string) {
        this.hostUrl = hostUrl;
        this.teamContext = {
            project: projectName,
            projectId: projectId,
            team: teamName,
            teamId: teamId
        };
        this.teamDayOffMap = {};
        this.capacityMap = {};
        this.iterations = [];
        this.updateUrls();
    }

    public updateEvent = (
        oldEvent: ICalendarEvent,
        iterationId: string,
        startDate: Date,
        endDate: Date,
        isHalfDay: boolean,
        selectedMemberName?: string,
        selectedMemberId?: string,
        halfDayType?: "AM" | "PM",
    ) => {
        const isTeam = oldEvent.member!.displayName === Everyone;
        const originalStartDate = shiftToUTC(new Date(oldEvent.startDate));
    
        startDate = shiftToUTC(startDate);
        endDate = shiftToUTC(endDate);
    
        if (isHalfDay && halfDayType) {
            oldEvent.halfDay = halfDayType;
    
            if (isHalfDay && halfDayType) {
                oldEvent.halfDay = halfDayType;
            
                if (halfDayType === "AM") {
                    startDate.setHours(9, 0, 0, 0);
                    endDate.setHours(12, 0, 0, 0);
                } else {
                    startDate.setHours(14, 0, 0, 0);
                    endDate.setHours(18, 0, 0, 0);
                }
            }
            
        } else {
            oldEvent.halfDay = undefined; // reset if switching back to full day
        }
    
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            delete this.teamDayOffMap[iterationId];
    
            const target = teamDaysOff.daysOff.find(d => d.start.valueOf() === originalStartDate.valueOf());
            if (target) {
                target.start = startDate;
                target.end = endDate;
            }
            if (selectedMemberName) {
                oldEvent.title = `${selectedMemberName} Day Off`;
            }
            
    
            const teamDaysOffPatch: TeamSettingsDaysOffPatch = { daysOff: teamDaysOff.daysOff };
            return this.workClient.updateTeamDaysOff(teamDaysOffPatch, this.teamContext, iterationId);
        } else {
            const capacity = this.capacityMap[iterationId][oldEvent.member!.id];
            delete this.capacityMap[iterationId];
    
            const target = capacity.daysOff.find(d => d.start.valueOf() === originalStartDate.valueOf());
            if (target) {
                target.start = startDate;
                target.end = endDate;
            }
            if (selectedMemberName) {
                oldEvent.title = `${selectedMemberName} Day Off`;
            }
            const capacityPatch: CapacityPatch = { activities: capacity.activities, daysOff: capacity.daysOff };
            const eventKey = `${oldEvent.member?.id}_${startDate.toISOString()}`;
                if (isHalfDay && halfDayType) {
                    this.customEventsMap[eventKey] = { halfDay: halfDayType };
                } else {
                    delete this.customEventsMap[eventKey]; // supprime si repassé en journée complète
                }
            return this.workClient.updateCapacityWithIdentityRef(capacityPatch, this.teamContext, iterationId, oldEvent.member!.id);
        }
    };
    
    public getCustomEventHalfDay(event: { member?: ICalendarMember; startDate?: string }): "AM" | "PM" | undefined {
        const key = `${event.member?.id}_${event.startDate}`;
        return this.customEventsMap[key]?.halfDay;
    }
    
    
    private buildTeamImageUrl(id: string): string {
        return this.hostUrl + "_api/_common/IdentityImage?id=" + id;
    }

    private fetchCapacities = (iterationId: string): Promise<TeamMemberCapacityIdentityRef[]> => {
        // fetch capacities only if not in cache
        if (this.capacityMap[iterationId]) {
            const capacities = [];
            for (var key in this.capacityMap[iterationId]) {
                capacities.push(this.capacityMap[iterationId][key]);
            }
            return Promise.resolve(capacities);
        }
        return this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId);
    };

    private fetchIterations = (): Promise<TeamSettingsIteration[]> => {
        // fetch iterations only if not in cache
        if (this.iterations.length > 0) {
            return Promise.resolve(this.iterations);
        }
        return this.workClient.getTeamIterations(this.teamContext);
    };

    private fetchTeamDaysOff = (iterationId: string): Promise<TeamSettingsDaysOff> => {
        // fetch team day off only if not in cache
        if (this.teamDayOffMap[iterationId]) {
            return Promise.resolve(this.teamDayOffMap[iterationId]);
        }
        return this.workClient.getTeamDaysOff(this.teamContext, iterationId);
    };
    private processCapacity = (
        
        capacities: TeamMemberCapacityIdentityRef[],
        iterationId: string,
        capacityCatagoryMap: { [id: string]: IEventCategory },
        calendarStart: Date,
        calendarEnd: Date
    ) => {
        this.groupedEventMap = {}; 

        if (!capacities?.length) return;
    
        for (const capacity of capacities) {
            if (!this.capacityMap[iterationId]) {
                this.capacityMap[iterationId] = {};
            }
            this.capacityMap[iterationId][capacity.teamMember.id] = capacity;
    
            for (const daysOffRange of capacity.daysOff) {
                const start = shiftToLocal(daysOffRange.start);
                const end = shiftToLocal(daysOffRange.end);
    
                const isHalfDay = start.getHours() === 9 || start.getHours() === 14;
                const halfDay = isHalfDay ? (start.getHours() === 9 ? "AM" : "PM") : undefined;
    
                const title = capacity.teamMember.displayName + " Day Off";
    
                const event: ICalendarEvent = {
                    category: title,
                    endDate: end.toISOString(),
                    iterationId,
                    member: capacity.teamMember,
                    startDate: start.toISOString(),
                    title,
                    icons: [],
                    halfDay
                };
    
                const icon: IEventIcon = {
                    linkedEvent: event,
                    src: capacity.teamMember.imageUrl
                };
    
                const dates = getDatesInRange(start, end);
                for (const dateObj of dates) {
                    if (calendarStart <= dateObj && dateObj <= calendarEnd) {
                       // const date = dateObj.toISOString().split("T")[0];
                       const normalized = new Date(dateObj);
                       normalized.setHours(0, 0, 0, 0);
                       const date = normalized.toISOString().split("T")[0];

    
                        console.log(`[processCapacity] ${date} | ${title} | halfDay=${halfDay ?? "none"}`);
    
                        // Count in summary
                        const current = capacityCatagoryMap[capacity.teamMember.id];
                        if (current) {
                            current.eventCount += isHalfDay ? 0.5 : 1;
                        } else {
                            capacityCatagoryMap[capacity.teamMember.id] = {
                                eventCount: isHalfDay ? 0.5 : 1,
                                imageUrl: capacity.teamMember.imageUrl,
                                subTitle: formatDate(dateObj, "MM-DD-YYYY"),
                                title: capacity.teamMember.displayName
                            };
                        }
    
                        // Build grouped event
                        if (!this.groupedEventMap[date]) {
                            this.groupedEventMap[date] = {
                                category: "Grouped Event",
                                endDate: date,
                                icons: [],
                                id: DaysOffId + "." + date,
                                member: event.member,
                                startDate: date,
                                title: "Grouped Event",
                                halfDay
                            };
                        }
    
                        const exists = this.groupedEventMap[date].icons.some(
                            i => i.src === icon.src && i.linkedEvent.startDate === event.startDate
                        );
                        if (!exists) {
                            this.groupedEventMap[date].icons.push(icon);
                        }
    
                        console.log(`[Icons] ${date} => ${this.groupedEventMap[date].icons.length} icônes`);
                    }
                }
            }
        }
    };
    
    
    
    private readonly processTeamDaysOff = (
        teamDaysOff: TeamSettingsDaysOff,
        iterationId: string,
        capacityCatagoryMap: { [id: string]: IEventCategory },
        calendarStart: Date,
        calendarEnd: Date
    ) => {
        if (teamDaysOff?.daysOff) {
            this.teamDayOffMap[iterationId] = teamDaysOff;
            const teamImage = this.buildTeamImageUrl(this.teamContext.teamId);
    
            for (const daysOffRange of teamDaysOff.daysOff) {
                const start = shiftToLocal(daysOffRange.start);
                const end = shiftToLocal(daysOffRange.end);
                const isHalfDay = start.getHours() === 9 || start.getHours() === 14;
                const halfDay = isHalfDay ? (start.getHours() === 9 ? "AM" : "PM") : undefined;
    
                const event: ICalendarEvent = {
                    category: this.teamContext.team,
                    endDate: end.toISOString(),
                    iterationId,
                    member: {
                        displayName: Everyone,
                        id: this.teamContext.teamId
                    },
                    startDate: start.toISOString(),
                    title: "Team Day Off",
                    icons: [],
                    halfDay
                };
    
                const icon: IEventIcon = {
                    linkedEvent: event,
                    src: teamImage
                };
    
                const dates = getDatesInRange(start, end);
                for (const dateObj of dates) {
                    if (calendarStart <= dateObj && dateObj <= calendarEnd) {
                        const date = dateObj.toISOString().split("T")[0];
    
                        // Summary
                        const cat = capacityCatagoryMap[this.teamContext.team];
                        if (cat) {
                            cat.eventCount += isHalfDay ? 0.5 : 1;
                        } else {
                            capacityCatagoryMap[this.teamContext.team] = {
                                eventCount: isHalfDay ? 0.5 : 1,
                                imageUrl: teamImage,
                                subTitle: formatDate(dateObj, "MM-DD-YYYY"),
                                title: this.teamContext.team
                            };
                        }
    
                        // Grouped Map
                        if (!this.groupedEventMap[date]) {
                            this.groupedEventMap[date] = {
                                category: "Grouped Event",
                                endDate: date,
                                icons: [],
                                id: DaysOffId + "." + date,
                                member: event.member,
                                startDate: date,
                                title: "Grouped Event",
                                halfDay
                            };
                        }
    
                        const exists = this.groupedEventMap[date].icons.some(
                            i => i.src === icon.src && i.linkedEvent.startDate === event.startDate
                        );
                        if (!exists) {
                            this.groupedEventMap[date].icons!.push(icon);
                        }
    
                        console.log(`TeamEvent - ${date}: ${this.groupedEventMap[date].icons.length} icons`);
                    }
                }
            }
        }
    };
    
    

    

    // Removed duplicate processTeamDaysOff method
    

    private updateUrls = () => {
        this.iterationUrl.value = this.hostUrl + this.teamContext.project + "/" + this.teamContext.team + "/_admin/_iterations";

        this.workClient.getTeamIterations(this.teamContext, "current").then(
            iterations => {
                if (iterations.length > 0) {
                    const iterationPath = iterations[0].path.substr(iterations[0].path.indexOf("\\") + 1);
                    this.capacityUrl.value =
                        this.hostUrl + this.teamContext.project + "/" + this.teamContext.team + "/_backlogs/capacity/" + iterationPath;
                } else {
                    this.capacityUrl.value = this.hostUrl + this.teamContext.project + "/" + this.teamContext.team + "/_admin/_iterations";
                }
            },
            error => {
                this.capacityUrl.value = this.hostUrl + this.teamContext.project + "/" + this.teamContext.team + "/_admin/_iterations";
            }
        );
    };
}
