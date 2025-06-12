import { getClient, IExtensionDataManager } from "azure-devops-extension-api";
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
    private dataManager?: IExtensionDataManager;
    private trainingMap: Record<string, number> = {};
private daysOffMap: Record<string, number> = {};

   // private groupedEventMap: { [date: string]: IDaysOffGroupedEvent } = {};  // Regroupement des événements

   private groupedEventMap: { [key: string]: IDaysOffGroupedEvent } = {};


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
    
        // UTC normalize
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
        } else {
            startDate.setUTCHours(0, 0, 0, 0);
            endDate.setUTCHours(23, 0, 0, 0); // ✅ FIX: plus de 23:59:59.999
        }
    
        const normalized = new Date(Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate()
        ));
        const dateKey = formatDate(normalized, "YYYY-MM-DD");
    
        const event: ICalendarEvent = {
            category: "Grouped Event",
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            iterationId,
            member: { id: memberId, displayName: memberName },
            icons: [],
            title: "Grouped Event",
            halfDay: isHalfDay ? halfDayType : undefined
        };
    
        const icon: IEventIcon = {
            linkedEvent: event,
            src: this.buildTeamImageUrl(memberId)
        };
    
        if (!this.groupedEventMap[dateKey]) {
            this.groupedEventMap[dateKey] = { ...event, icons: [icon] };
        } else {
            const exists = this.groupedEventMap[dateKey].icons?.some(
                i =>
                    i.linkedEvent.member?.id === memberId &&
                    new Date(i.linkedEvent.startDate).getTime() === new Date(event.startDate).getTime()
            );
            if (!exists) this.groupedEventMap[dateKey].icons!.push(icon);
        }
    
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            const patch: TeamSettingsDaysOffPatch = {
                daysOff: [...teamDaysOff.daysOff, { start: startDate, end: endDate }]
            };
            this.teamDayOffMap[iterationId] = {
                ...teamDaysOff,
                daysOff: patch.daysOff
            };
            return this.workClient.updateTeamDaysOff(patch, this.teamContext, iterationId);
        } else {
            const existingCap = this.capacityMap[iterationId]?.[memberId];
            const capacity: TeamMemberCapacityIdentityRef = existingCap ?? {
                activities: [{ capacityPerDay: 0, name: "" }],
                daysOff: [],
                teamMember: { id: memberId, displayName: memberName, imageUrl: this.buildTeamImageUrl(memberId) }
            };
    
            capacity.daysOff = capacity.daysOff.filter(d =>
                endDate < d.start || startDate > d.end
            );
    
            const overlap = capacity.daysOff.some(d =>
                (startDate <= d.end && endDate >= d.start)
            );
    
            if (overlap) {
                console.warn("Overlapping DayOff détecté. Annulé.");
                return Promise.reject("Overlapping date range.");
            }
    
            capacity.daysOff.push({ start: startDate, end: endDate });
    
            if (!this.capacityMap[iterationId]) this.capacityMap[iterationId] = {};
            this.capacityMap[iterationId][memberId] = capacity;
    
            const patch: CapacityPatch = {
                activities: capacity.activities,
                daysOff: capacity.daysOff
            };
    
            const key = `${memberId}_${dateKey}`;
            if (isHalfDay && halfDayType) {
                this.customEventsMap[key] = { halfDay: halfDayType };
            } else {
                delete this.customEventsMap[key];
            }
    
            return this.workClient.updateCapacityWithIdentityRef(patch, this.teamContext, iterationId, memberId);
        }
    };
    
    private async processTrainingEvents(
        
        capacityCatagoryMap: { [id: string]: IEventCategory },
        calendarStart: Date,
        calendarEnd: Date
    ): Promise<void> {

        Object.keys(this.groupedEventMap).forEach(dateKey => {
            const item = this.groupedEventMap[dateKey];
            if (item?.category === "Training") {
                delete this.groupedEventMap[dateKey];
                console.log(`[Training] 🧹 Nettoyage groupedEventMap[${dateKey}]`);
            }
        });
        if (!this.freeForm?.getEventsAsync) {
            console.warn("[Training] ⚠️ Source freeForm non initialisée");
            return;
        }
    
        console.log("[Training] 📥 Appel de getEventsAsync...");
        const trainingEvents = await this.freeForm.getEventsAsync({
            start: calendarStart,
            end: calendarEnd,
            timeZone: "UTC"
        });
    
        console.log("[Training] 📦 Events received from freeForm.getEventsAsync:", trainingEvents);
        console.log(`[Training] 🔄 Événements récupérés : ${trainingEvents.length}`);
    
        const filtered = trainingEvents.filter((event: { extendedProps?: { category?: string; member?: { id?: string } } }) =>
            event.extendedProps?.category === "Training" &&
            event.extendedProps?.member?.id &&
            event.extendedProps?.member?.id !== "default-id"
        );
    
        for (const ev of trainingEvents) {
            console.log(`[Training] 🔬 extendedProps:`, ev.extendedProps);
        }
    
        console.log(`[Training]  Événements filtrés en Training : ${filtered.length}`);
    
        const seenKeys = new Set<string>();
        // 🔧 On nettoie les anciennes icônes Training du groupedEventMap
Object.keys(this.groupedEventMap).forEach(dateKey => {
    if (this.groupedEventMap[dateKey]?.category === "Training") {
        delete this.groupedEventMap[dateKey];
        console.log(`[Training] 🧹 Suppression groupedEventMap pour ${dateKey}`);
    }
});

        for (const event of filtered) {
            const memberId = event.extendedProps.member.id;
            const displayName = event.extendedProps.member.displayName || "Unknown";
            const imageUrl = this.buildTeamImageUrl(memberId);
    
            const start = new Date(event.start!);
            const end = new Date(event.end!);
    
            // ✅ Patch ici : normalisation des événements all-day d'un seul jour
            const oneDay = 1000 * 60 * 60 * 24;
            if (
                !event.extendedProps.halfDay &&
                end.getTime() - start.getTime() === oneDay &&
                start.getUTCHours() === 0 &&
                end.getUTCHours() === 0
            ) {
                end.setDate(end.getDate() - 1);
                end.setHours(23, 59, 59, 999);
            }
    
            const { halfDay, increment } = this.isRealHalfDay(start, end);
            const realHalfDay = halfDay ?? undefined;
    
            const icon: IEventIcon = {
                linkedEvent: {
                    startDate: start.toISOString(),
                    endDate: end.toISOString(),
                    category: "Training",
                    member: { id: memberId, displayName },
                    icons: [],
                    title: "Training",
                    halfDay: realHalfDay
                },
                src: imageUrl
            };
    
            const dates = getDatesInRange(start, end).filter(d =>
                d.getDay() !== 0 && d.getDay() !== 6 &&
                d >= calendarStart && d <= calendarEnd
            );
    
            console.log(`[Training] 🔍 ${displayName} | ${dates.length} jour(s) entre ${start.toISOString()} → ${end.toISOString()} | HalfDay=${realHalfDay}`);
    
            for (const dateObj of dates) {
                const normalized = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
                const dateKey = formatDate(normalized, "YYYY-MM-DD");
                const dayKey = `${memberId}_${dateKey}`;
    
                if (!capacityCatagoryMap[memberId]) {
                    capacityCatagoryMap[memberId] = {
                        eventCount: 0,
                        imageUrl,
                        subTitle: "",
                        title: displayName,
                        __days: new Set()
                    } as any;
                }
    
                const current = capacityCatagoryMap[memberId] as any;
    
                if (!current.__days.has(dayKey)) {
                    current.eventCount += increment;
                    current.__days.add(dayKey);
                }
    
                console.log(`[Training]  ${displayName} → +${increment} jour(s) @ ${dateKey} (total: ${current.eventCount})`);
    
                if (seenKeys.has(dayKey)) continue;
                seenKeys.add(dayKey);
    
                if (!this.groupedEventMap[dateKey]) {
                    this.groupedEventMap[dateKey] = {
                        category: "Training",
                        endDate: dateKey,
                        icons: [],
                        id: `training.${dateKey}`,
                        member: { id: memberId, displayName },
                        startDate: dateKey,
                        title: "Training",
                        halfDay: realHalfDay
                    };
                }
    
                const exists = this.groupedEventMap[dateKey].icons.some(i =>
                    i.linkedEvent.member?.id === memberId &&
                    new Date(i.linkedEvent.startDate).getTime() === new Date(icon.linkedEvent.startDate).getTime() &&
                    i.linkedEvent.halfDay === realHalfDay
                );
    
                if (!exists) {
                    this.groupedEventMap[dateKey].icons.push(icon);
                    console.log(`[Training]  Icône ajoutée pour ${displayName} à ${dateKey}`);
                }
    
                console.log(`[processTraining] ${dateKey} → ${displayName} | halfDay=${realHalfDay ?? "none"}`);
            }
    
            console.log("[Training] ✅ processTrainingEvents terminé");
        }
    }
    
    
    public deleteEvent = (event: ICalendarEvent, iterationId: string) => {
        const isTeam = event.member?.displayName === Everyone;
    
        const startDateObj = new Date(event.startDate);
        const endDateObj = new Date(event.endDate);
    
        const dateKey = formatDate(shiftToUTC(startDateObj), "YYYY-MM-DD"); 
        const eventHalfDay = event.halfDay ?? "none";
    
      //  console.log(`[deleteEvent] Tentative suppression`);
      //  console.log(`[deleteEvent] Member: ${event.member?.displayName}`);
      //  console.log(`[deleteEvent] Start ISO: ${startDateObj.toISOString()}`);
      //  console.log(`[deleteEvent] End ISO:   ${endDateObj.toISOString()}`);
      //  console.log(`[deleteEvent] HalfDay: ${eventHalfDay}`);
    
        // 1. Clean groupedEventMap icons
        const icons = this.groupedEventMap[dateKey]?.icons;
        if (icons) {
            this.groupedEventMap[dateKey].icons = icons.filter(i =>
                i.linkedEvent.member?.id !== event.member?.id ||
                i.linkedEvent.halfDay !== eventHalfDay ||
                new Date(i.linkedEvent.startDate).getTime() !== startDateObj.getTime()
            );
            if (this.groupedEventMap[dateKey].icons.length === 0) {
                delete this.groupedEventMap[dateKey];
            }
        }
    
        // 2. Clean halfday cache
        const cacheKey = `${event.member?.id}_${dateKey}`;
        delete this.customEventsMap[cacheKey];
    
        // 3. Clean capacity summary
        const cat = this.capacitySummaryData.value.find(c => c.title === event.member?.displayName);
        if (cat && (cat as any).__days) {
            const days = (cat as any).__days as Set<string>;
            const dayKey = `${event.member?.id}_${dateKey}`;
            if (days.has(dayKey)) {
                days.delete(dayKey);
                const decrement = eventHalfDay !== "none" ? 0.5 : 1;
                cat.eventCount -= decrement;
            }
        }
    
        // 4. Matching logic (halfDay safe)
        const inferHalfDay = (start: Date | string, end: Date | string): "AM" | "PM" | "none" => {
            const startHour = new Date(start).getUTCHours();
            const endHour = new Date(end).getUTCHours();
            if (startHour === 9 && endHour === 12) return "AM";
            if (startHour === 14 && endHour === 18) return "PM";
            return "none";
        };
    
        const isSameDayAndHalfDay = (d: { start: Date | string; end: Date | string }) => {
            const dDateKey = formatDate(shiftToUTC(new Date(d.start)), "YYYY-MM-DD"); 
            const dHalfDay = inferHalfDay(d.start, d.end);
            return dDateKey === dateKey && dHalfDay === eventHalfDay;
        };
    
        // 5. Delete from ADO
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            if (!teamDaysOff) return;
    
            console.log("[deleteEvent] Before deletion - teamDaysOff:", teamDaysOff.daysOff);
    
            teamDaysOff.daysOff = teamDaysOff.daysOff.filter(d => !isSameDayAndHalfDay(d));
    
            console.log("[deleteEvent] After deletion - teamDaysOff:", teamDaysOff.daysOff);
    
            return this.workClient.updateTeamDaysOff(
                { daysOff: teamDaysOff.daysOff },
                this.teamContext,
                iterationId
            );
        }
    
        const capacity = this.capacityMap[iterationId]?.[event.member!.id];
        if (!capacity) return;
    
        console.log("[deleteEvent] Before deletion - daysOff:", capacity.daysOff);
    
        capacity.daysOff = capacity.daysOff.filter(d => !isSameDayAndHalfDay(d));
    
        console.log("[deleteEvent] After deletion - daysOff:", capacity.daysOff);
    
        return this.workClient.updateCapacityWithIdentityRef(
            { activities: capacity.activities, daysOff: capacity.daysOff },
            this.teamContext,
            iterationId,
            event.member!.id
        );
    };
    
    
    
    public getCapacitySummaryData = (): ObservableArray<IEventCategory> => {
        return this.capacitySummaryData;
    };

    public getCapacityUrl = (): ObservableValue<string> => {
        return this.capacityUrl;
    };
    public testDaysOff(): void {
        const logEvent = (label: string, start: Date, end: Date) => {
            console.log(`[🧪 ${label}]`);
            console.log("Start (local):", start.toString());
            console.log("End   (local):", end.toString());
            console.log("Start (ISO):", start.toISOString());
            console.log("End   (ISO):", end.toISOString());
            console.log("Duration (ms):", end.getTime() - start.getTime());
            console.log("------------");
        };
    
        const today = new Date(); // Ex: 2025-06-12
        today.setHours(0, 0, 0, 0);
    
        // 📌 FULL DAY: 00:00 to 23:59 (we simulate it)
        const fullDayStart = new Date(today);
        const fullDayEnd = new Date(today);
        fullDayEnd.setHours(23, 59, 59, 999); // Not exclusive yet
    
        // 📌 AM (09:00 → 12:00)
        const amStart = new Date(today);
        amStart.setHours(9, 0, 0, 0);
        const amEnd = new Date(today);
        amEnd.setHours(12, 0, 0, 0);
    
        // 📌 PM (14:00 → 18:00)
        const pmStart = new Date(today);
        pmStart.setHours(14, 0, 0, 0);
        const pmEnd = new Date(today);
        pmEnd.setHours(18, 0, 0, 0);
    
        // Simule le comportement de getEvents
        const normalizeFullDay = (start: Date, end: Date) => {
            const adjustedEnd = new Date(end);
            adjustedEnd.setDate(end.getDate() + 1);
            adjustedEnd.setHours(0, 0, 0, 0);
            return adjustedEnd;
        };
    
        logEvent("FULL DAY (before adjust)", fullDayStart, fullDayEnd);
    
        const fullDayAdjustedEnd = normalizeFullDay(fullDayStart, fullDayEnd);
        logEvent("FULL DAY (after adjust)", fullDayStart, fullDayAdjustedEnd);
    
        logEvent("AM HalfDay", amStart, amEnd);
        logEvent("PM HalfDay", pmStart, pmEnd);
    };
    

    public getEvents = (
        arg: {
            start: Date;
            end: Date;
            timeZone: string;
        },
        successCallback: (events: EventInput[]) => void,
        failureCallback: (error: EventSourceError) => void
    ): void => {
        this.testDaysOff();
        const capacityPromises: PromiseLike<TeamMemberCapacity[]>[] = [];
        const teamDaysOffPromises: PromiseLike<TeamSettingsDaysOff>[] = [];
        const renderedEvents: EventInput[] = [];
        const capacityCatagoryMap: { [id: string]: IEventCategory } = {};
        const currentIterations: IEventCategory[] = [];
    
        this.groupedEventMap = {};
        this.capacitySummaryData.splice(0, this.capacitySummaryData.length);
        Object.keys(this.customEventsMap).forEach(k => delete this.customEventsMap[k]);
        Object.keys(this.groupedEventMap).forEach(k => delete this.groupedEventMap[k]);
    
        this.fetchIterations().then(iterations => {
            if (!iterations) iterations = [];
            this.iterations = iterations;
    
            const calendarStart = arg.start;
            const calendarEnd = arg.end;
    
            for (const iteration of iterations) {
                Object.keys(capacityCatagoryMap).forEach(id => {
                    capacityCatagoryMap[id].eventCount = 0;
                    (capacityCatagoryMap[id] as any).__days = new Set();
                });
    
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
                        const color = (iteration.attributes.startDate <= now && now <= iteration.attributes.finishDate)
                            ? generateColor("currentIteration")
                            : generateColor("otherIteration");
    
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
                            subTitle: `${formatDate(iterationStart, "MONTH-DD")} - ${formatDate(iterationEnd, "MONTH-DD")}`,
                            title: iteration.name
                        });
    
                        console.log(`[getEvents] Loaded iteration: ${iteration.name}`);
                    }
                } else {
                    loadIterationData = true;
                }
    
                if (loadIterationData) {
                    const teamDaysOffPromise = this.fetchTeamDaysOff(iteration.id);
                    teamDaysOffPromises.push(teamDaysOffPromise);
                    teamDaysOffPromise.then(teamDaysOff => {
                        this.processTeamDaysOff(teamDaysOff, iteration.id, capacityCatagoryMap, calendarStart, calendarEnd);
                    });
    
                    const capacityPromise = this.fetchCapacities(iteration.id);
                    capacityPromises.push(capacityPromise);
                    capacityPromise.then(async capacities => {
                        this.processCapacity(capacities, iteration.id, capacityCatagoryMap, calendarStart, calendarEnd);
                        await this.processTrainingEvents(capacityCatagoryMap, calendarStart, calendarEnd);
                    });
                }
            }
    
            Promise.all(teamDaysOffPromises).then(() => {
                Promise.all(capacityPromises).then(() => {
                    Object.keys(this.groupedEventMap).forEach(id => {
                        const grouped = this.groupedEventMap[id];
                        const startRaw = new Date(grouped.startDate);
                        const endRaw = new Date(grouped.endDate);
    
                        const isHalfDay = grouped.halfDay === "AM" || grouped.halfDay === "PM";
                        const start = shiftToLocal(startRaw);
                        const end = shiftToLocal(endRaw);
    
                        const adjustedEnd = new Date(end);
                        if (!isHalfDay) {
                            adjustedEnd.setDate(adjustedEnd.getDate() + 1); // exclusive end only for full day
                        }
    
                        if (
                            (calendarStart <= start && start <= calendarEnd) ||
                            (calendarStart <= end && end <= calendarEnd)
                        ) {
                            console.log(`[getEvents] Pushed event: ${start.toISOString()} → ${adjustedEnd.toISOString()} | halfDay=${grouped.halfDay ?? "full"}`);
    
                            renderedEvents.push({
                                allDay: !isHalfDay,
                                color: "transparent",
                                editable: false,
                                id: `${DaysOffId}_${grouped.member?.id}_${grouped.startDate}`,
                                start,
                                end: adjustedEnd,
                                title: "",
                                extendedProps: {
                                    member: grouped.member,
                                    halfDay: grouped.halfDay
                                }
                            });
                        }
                    });
    
                    successCallback(renderedEvents);
                    this.iterationSummaryData.value = currentIterations;
    
                    const updatedSummary = Object.keys(capacityCatagoryMap).map(key => {
                        const cat = capacityCatagoryMap[key];
                        const rounded = Number(cat.eventCount.toFixed(1));
                        cat.subTitle = `${rounded} day${rounded !== 1 ? "s" : ""} off`;
                        return cat;
                    });
    
                    this.capacitySummaryData.splice(0, this.capacitySummaryData.length, ...updatedSummary);
                });
            });
        });
    };

    
    public getGroupedEventForDate = (date: Date): IDaysOffGroupedEvent | undefined => {
        const normalized = new Date(date);
        normalized.setUTCHours(0, 0, 0, 0);
        const dateKey = formatDate(normalized, "YYYY-MM-DD");
        return this.groupedEventMap[dateKey];

    };
    freeForm: any;
    
    
    public setDataManager(manager: IExtensionDataManager): void {
        this.dataManager = manager;
    }
    

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
        this.capacitySummaryData.value = [];
        this.iterationSummaryData.value = [];
        this.groupedEventMap = {};

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
        const isTeam = oldEvent.member?.displayName === Everyone;
        const originalStartDate = shiftToUTC(new Date(oldEvent.startDate));
    
        startDate = shiftToUTC(startDate);
        endDate = shiftToUTC(endDate);
    
        if (isHalfDay && halfDayType) {
            if (halfDayType === "AM") {
                startDate.setHours(9, 0, 0, 0);
                endDate.setHours(12, 0, 0, 0);
            } else {
                startDate.setHours(14, 0, 0, 0);
                endDate.setHours(18, 0, 0, 0);
            }
            oldEvent.halfDay = halfDayType;
        } else {
            oldEvent.halfDay = undefined;
        }
    
        const oldKey = `${oldEvent.member?.id}_${formatDate(shiftToLocal(originalStartDate), "YYYY-MM-DD")}`;
        delete this.customEventsMap[oldKey]; // old day cleanup
        const newKey = `${oldEvent.member?.id}_${formatDate(shiftToLocal(startDate), "YYYY-MM-DD")}`;
        if (isHalfDay && halfDayType) {
            this.customEventsMap[newKey] = { halfDay: halfDayType };
        }
    
        //  Nettoyage des icônes obsolètes
        const normalizedOld = new Date(originalStartDate);
        normalizedOld.setUTCHours(0, 0, 0, 0); // reste en UTC pour être cohérent
        const dateKeyOld = formatDate(normalizedOld, "YYYY-MM-DD"); 
        
    
        const icons = this.groupedEventMap[dateKeyOld]?.icons;
        if (icons) {
            this.groupedEventMap[dateKeyOld].icons = icons.filter(
                i =>
                    i.linkedEvent.member?.id !== oldEvent.member?.id ||
                    new Date(i.linkedEvent.startDate).getTime() !== originalStartDate.getTime()
            );
            if (this.groupedEventMap[dateKeyOld].icons.length === 0) {
                delete this.groupedEventMap[dateKeyOld];
            }
        }
    
        //  Compteur de résumé
        const cat = this.capacitySummaryData.value.find(c => c.title === oldEvent.member?.displayName);
        if (cat && (cat as any).__days) {
            const days = (cat as any).__days as Set<string>;
            if (days.has(normalizedOld.toISOString())) {
                days.delete(normalizedOld.toISOString());
                cat.eventCount -= oldEvent.halfDay ? 0.5 : 1;
            }
        }
    
        // Mise à jour des données ADO
        if (isTeam) {
            const teamDaysOff = this.teamDayOffMap[iterationId];
            const target = teamDaysOff.daysOff.find(d => d.start.valueOf() === originalStartDate.valueOf());
            if (target) {
                target.start = startDate;
                target.end = endDate;
            }
            if (selectedMemberName) {
                oldEvent.title = `${selectedMemberName} Day Off`;
            }
            return this.workClient.updateTeamDaysOff({ daysOff: teamDaysOff.daysOff }, this.teamContext, iterationId);
        } else {
            const capacity = this.capacityMap[iterationId]?.[oldEvent.member!.id];
            const target = capacity?.daysOff.find(d => d.start.valueOf() === originalStartDate.valueOf());
            if (target) {
                target.start = startDate;
                target.end = endDate;
            }
            if (selectedMemberName) {
                oldEvent.title = `${selectedMemberName} Day Off`;
            }
            return this.workClient.updateCapacityWithIdentityRef(
                { activities: capacity.activities, daysOff: capacity.daysOff },
                this.teamContext,
                iterationId,
                oldEvent.member!.id
            );
        }
    };
    
    public getCustomEventHalfDay(event: { member?: ICalendarMember; startDate?: string }): "AM" | "PM" | undefined {
        if (!event.startDate || !event.member?.id) return undefined;
        const normalized = new Date(event.startDate);
        const dateKey = formatDate(normalized, "YYYY-MM-DD");
        const key = `${event.member.id}_${dateKey}`;

        return this.customEventsMap[key]?.halfDay;
    }
    
    
    
    
    private buildTeamImageUrl(id: string): string {
        return this.hostUrl + "_api/_common/IdentityImage?id=" + id;
    }
    public assertClientReady(): void {
        if (!this.workClient) {
            throw new Error("WorkClient is not initialized. Use setWorkClient(...) before calling any API.");
        }
        if (!this.teamContext?.project || !this.teamContext?.team) {
            throw new Error("TeamContext is missing required fields (project, team).");
        }
    }
    
    private fetchCapacities = async (iterationId: string): Promise<TeamMemberCapacityIdentityRef[]> => {
        //  Toujours refetch depuis ADO
        const fresh = await this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId);
    
        this.capacityMap[iterationId] = {};
        for (const cap of fresh) {
            this.capacityMap[iterationId][cap.teamMember.id] = cap;
        }
    
        return fresh;
    };
    
    

   public fetchIterations = (): Promise<TeamSettingsIteration[]> => {
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
        if (!capacities?.length) return;
    
        const seenKeys = new Set<string>();
    
        for (const capacity of capacities) {
            const memberId = capacity.teamMember.id;
            const displayName = capacity.teamMember.displayName;
            const imageUrl = capacity.teamMember.imageUrl;
    
            if (!this.capacityMap[iterationId]) this.capacityMap[iterationId] = {};
            this.capacityMap[iterationId][memberId] = capacity;
    
            for (const range of capacity.daysOff) {
                const isFullDay = range.start.getUTCHours() === 0 && range.end.getUTCHours() === 23;
    
                const start = isFullDay
                    ? new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate(), 0, 0, 0, 0))
                    : shiftToLocal(range.start);
    
                const end = isFullDay
                    ? new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), range.end.getUTCDate(), 23, 0, 0, 0))
                    : shiftToLocal(range.end);
    
                const { halfDay, increment } = this.isRealHalfDay(start, end);
                const realHalfDay = halfDay ?? undefined;
    
                const title = `${displayName} Day Off`;
    
                const event: ICalendarEvent = {
                    category: title,
                    endDate: end.toISOString(),
                    iterationId,
                    member: capacity.teamMember,
                    startDate: start.toISOString(),
                    title,
                    icons: [],
                    halfDay: realHalfDay
                };
    
                const icon: IEventIcon = {
                    linkedEvent: event,
                    src: imageUrl
                };
    
                const dates = getDatesInRange(start, end);
                for (const dateObj of dates) {
                    if (calendarStart <= dateObj && dateObj <= calendarEnd) {
                        const normalized = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
                        const date = formatDate(normalized, "YYYY-MM-DD");
    
                        const dayKey = `${memberId}_${date}`;
    
                        if (!capacityCatagoryMap[memberId]) {
                            capacityCatagoryMap[memberId] = {
                                eventCount: 0,
                                imageUrl,
                                subTitle: "",
                                title: displayName,
                                __days: new Set()
                            } as any;
                        }
    
                        const current = capacityCatagoryMap[memberId] as any;
    
                        if (!current.__days.has(dayKey)) {
                            current.eventCount += increment;
                            current.__days.add(dayKey);
                        }
    
                        if (seenKeys.has(dayKey)) continue;
                        seenKeys.add(dayKey);
    
                        if (!this.groupedEventMap[date]) {
                            this.groupedEventMap[date] = {
                                category: "Grouped Event",
                                endDate: date,
                                icons: [],
                                id: DaysOffId + "." + date,
                                member: event.member,
                                startDate: date,
                                title: "Grouped Event",
                                halfDay: realHalfDay
                            };
                        }
    
                        const exists = this.groupedEventMap[date].icons.some(i => {
                            return (
                                i.linkedEvent.member?.id === event.member?.id &&
                                new Date(i.linkedEvent.startDate).toISOString() === new Date(event.startDate).toISOString() &&
                                i.linkedEvent.halfDay === realHalfDay
                            );
                        });
    
                        if (!exists) {
                            this.groupedEventMap[date].icons.push(icon);
                            console.log(`[👤 Icon insert] ${date} → ${event.member?.displayName} (${realHalfDay ?? "full"})`);
                        } else {
                            console.warn(`[⚠️ Duplication évitée] ${date} → ${event.member?.displayName} (${realHalfDay ?? "full"})`);
                        }
                    }
                }
            }
        }
    };
    
    
    
    
    private processTeamDaysOff = (
        teamDaysOff: TeamSettingsDaysOff,
        iterationId: string,
        capacityCatagoryMap: { [id: string]: IEventCategory },
        calendarStart: Date,
        calendarEnd: Date
    ) => {
        if (!teamDaysOff?.daysOff) return;
    
        this.teamDayOffMap[iterationId] = teamDaysOff;
        const teamId = this.teamContext.teamId;
        const teamName = this.teamContext.team;
        const teamImage = this.buildTeamImageUrl(teamId);
    
        for (const range of teamDaysOff.daysOff) {
            const isFullDay = range.start.getUTCHours() === 0 && range.end.getUTCHours() === 23;
    
            const start = isFullDay
                ? new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate(), 0, 0, 0, 0))
                : shiftToLocal(range.start);
    
            const end = isFullDay
                ? new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), range.end.getUTCDate(), 23, 0, 0, 0))
                : shiftToLocal(range.end);
    
            const { halfDay, increment } = this.isRealHalfDay(start, end);
            const realHalfDay = halfDay ?? undefined;
    
            const event: ICalendarEvent = {
                category: teamName,
                endDate: end.toISOString(),
                iterationId,
                member: { displayName: Everyone, id: teamId },
                startDate: start.toISOString(),
                title: "Team Day Off",
                icons: [],
                halfDay: realHalfDay
            };
    
            const icon: IEventIcon = {
                linkedEvent: event,
                src: teamImage
            };
    
            const dates = getDatesInRange(start, end);
    
            for (const dateObj of dates) {
                if (calendarStart <= dateObj && dateObj <= calendarEnd) {
                    const normalized = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
                    const date = formatDate(normalized, "YYYY-MM-DD");
    
                    const dayKey = `${teamId}_${date}`;
    
                    if (!capacityCatagoryMap[teamName]) {
                        capacityCatagoryMap[teamName] = {
                            eventCount: 0,
                            imageUrl: teamImage,
                            subTitle: "",
                            title: teamName,
                            __days: new Set()
                        } as any;
                    }
    
                    const current = capacityCatagoryMap[teamName] as any;
    
                    if (!current.__days.has(dayKey)) {
                        current.eventCount += increment;
                        current.__days.add(dayKey);
                    }
    
                    if (!this.groupedEventMap[date]) {
                        this.groupedEventMap[date] = {
                            category: "Grouped Event",
                            endDate: date,
                            icons: [],
                            id: DaysOffId + "." + date,
                            member: event.member,
                            startDate: date,
                            title: "Grouped Event",
                            halfDay: realHalfDay
                        };
                    }
    
                    const exists = this.groupedEventMap[date].icons.some(
                        i =>
                            i.linkedEvent.member?.id === event.member?.id &&
                            new Date(i.linkedEvent.startDate).toISOString() === new Date(event.startDate).toISOString() &&
                            i.linkedEvent.halfDay === realHalfDay
                    );
    
                    if (!exists) {
                        this.groupedEventMap[date].icons.push(icon);
                        console.log(`[processTeamDaysOff ✅] ${date} → Added ${event.member?.displayName} (${realHalfDay ?? "full"})`);
                    } else {
                        console.warn(`[processTeamDaysOff ⚠️] ${date} → Duplication évitée pour ${event.member?.displayName}`);
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
    private isRealHalfDay = (start: Date, end: Date): { halfDay?: "AM" | "PM"; increment: number } => {
        const startH = start.getHours();
        const endH = end.getHours();
    
        if (startH === 9 && endH === 12) {
            return { halfDay: "AM", increment: 0.5 };
        }
        if (startH === 14 && endH === 18) {
            return { halfDay: "PM", increment: 0.5 };
        }
        return { increment: 1 }; // full day
    };
    private async clearStoredEvents(): Promise<void> {
        if (!this.dataManager) return;
    
        const collectionName = "DaysOffData"; 
    
        try {
            const docs = await this.dataManager.getDocuments(collectionName, {
                scopeType: "User",
                defaultValue: []
            });
    
            for (const doc of docs) {
                if (doc.id !== "$settings") {
                    await this.dataManager.deleteDocument(collectionName, doc.id, {
                        scopeType: "User"
                    });
                }
            }
        } catch (err) {
            console.error("Erreur suppression documents persistés :", err);
        }
    }
    
    public async resetAllState(): Promise<void> {
       // console.log(" RESET COMPLET DE L'EXTENSION");
    
        this.capacitySummaryData.splice(0, this.capacitySummaryData.length);
        this.iterationSummaryData.splice(0, this.iterationSummaryData.length);
        this.groupedEventMap = {};
        this.customEventsMap = {};
        this.capacityMap = {};
        this.teamDayOffMap = {};
        this.iterations = [];
    
        try {
            await this.clearStoredEvents?.();
        } catch (e) {
            const status = (e as any)?.status;
            if (status !== 404) {
                console.error(" clearStoredEvents failed:", e);
            }
        }
    
        try {
            const iterations = await this.workClient.getTeamIterations(this.teamContext);
            for (const iteration of iterations) {
                const iterationId = iteration.id;
    
                try {
                    const teamDaysOff = await this.workClient.getTeamDaysOff(this.teamContext, iterationId);
                    if (teamDaysOff?.daysOff?.length) {
                        await this.workClient.updateTeamDaysOff({ daysOff: [] }, this.teamContext, iterationId);
                        console.log(`TeamDaysOff supprimés pour ${iteration.name}`);
                    }
                } catch (e) {
                    console.warn(` Erreur teamDaysOff pour ${iteration.name}`, e);
                }
    
                try {
                    const capacities = await this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId);
                    for (const capacity of capacities) {
                        const memberId = capacity.teamMember.id;
                        await this.workClient.updateCapacityWithIdentityRef(
                            { activities: capacity.activities, daysOff: [] },
                            this.teamContext,
                            iterationId,
                            memberId
                        );
                        // ⛑️ Sanitize daysOff range for ADO (clamp to iteration bounds)


                        console.log(` DaysOff supprimés pour ${capacity.teamMember.displayName} (${iteration.name})`);
                    }
                } catch (e) {
                    console.warn(` Erreur capacities pour ${iteration.name}`, e);
                }
            }
        } catch (e) {
            console.error(" Erreur wipe Azure DevOps:", e);
        }
    
        try {
            const versionKey = `last-init-version-${this.teamContext.projectId}`;
            await this.dataManager?.deleteDocument("$settings", versionKey, { scopeType: "User" });
            console.log(" Clé de version supprimée");
        } catch (e) {
            const status = (e as any)?.status;
            if (status !== 404) {
                console.error(" Erreur suppression clé version", e);
            }
        }
    
        localStorage.setItem("forceCalendarRefresh", "true");
    }
    public async getTrainingDaysByMember(memberId: string, rangeStart: Date, rangeEnd: Date): Promise<Date[]> {
        try {
            console.log(`\n[Training] 🔍 Recherche de formations pour ${memberId}`);
            console.log(`[Training] Période demandée : ${rangeStart.toISOString()} → ${rangeEnd.toISOString()}`);
    
            if (!this.freeForm?.getEvents) {
                console.warn("[Training] ❌ Source freeForm non initialisée !");
                return [];
            }
    
            const events = await this.freeForm.getEventsAsync
            ({ start: rangeStart, end: rangeEnd, timeZone: "UTC" });

    
            console.log(`[Training] 🔄 Événements récupérés : ${events.length}`);
            for (const e of events) {
                console.log(`[Training] • ${e.title} | Catégorie=${e.extendedProps?.category} | Membre=${e.extendedProps?.member?.id}`);
            }
    
            const trainingEvents = events.filter((event: { extendedProps: { category: string; member: { id: string; }; }; }) => {
                if (!event?.extendedProps) return false;
                return (
                    event.extendedProps.category === "Training" &&
                    event.extendedProps.member?.id === memberId &&
                    event.extendedProps.member?.id !== 'default-id'
                );
            });
    
            console.log(`[Training] ✅ Formations retenues : ${trainingEvents.length}`);
    
            if (!trainingEvents.length) {
                console.log(`[Training] ❌ Aucune formation trouvée pour ${memberId}`);
                return [];
            }
    
            const result = new Set<string>();
    
            for (const event of trainingEvents) {
                if (!event.start || !event.end) continue;
                console.log(`[Training] ➕ Analyse de ${event.title}`);
                console.log("  - event.member?.id:", event.member?.id);
                console.log("  - période:", event.startDate, "→", event.endDate);
                const dates = getDatesInRange(
                    new Date(event.start),
                    new Date(event.end)
                ).filter(date => {
                    const day = date.getDay();
                    return day !== 0 && day !== 6 && date >= rangeStart && date <= rangeEnd;
                });
    
                console.log(`[Training] 📅 Jours trouvés dans ${event.title} : ${dates.map(d => d.toISOString()).join(", ")}`);
                dates.forEach(date => result.add(date.toISOString()));
            }
    
            const uniqueDates = Array.from(result).map(dateStr => new Date(dateStr));
            console.log(`[Training] 📊 Total unique jours de formation : ${uniqueDates.length}`);
    
            return uniqueDates;
            
    
        } catch (error) {
            console.error("[Training] ❌ Erreur pendant le traitement :", error);
            return [];
        }
        
    }
    

private countWorkingDays(start: Date, end: Date): number {
    let count = 0;
    const d = new Date(start);
    while (d <= end) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}

/*public async prepareCapacityAdjustments(iterationId: string): Promise<void> {
    const iteration = this.iterations.find(it => it.id === iterationId);
    if (!iteration) return;

    const start = new Date(iteration.attributes.startDate);
    const end = new Date(iteration.attributes.finishDate);

    const capacities = await this.fetchCapacities(iterationId);

    for (const capacity of capacities) {
        const memberId = capacity.teamMember.id;
        let daysOffTotal = 0;

        for (const range of capacity.daysOff ?? []) {
            const startClamped = new Date(Math.max(start.getTime(), range.start.getTime()));
            const endClamped = new Date(Math.min(end.getTime(), range.end.getTime()));
            if (endClamped < startClamped) continue;

            const workingDays = getDatesInRange(startClamped, endClamped)
                .filter(d => d.getDay() !== 0 && d.getDay() !== 6);

            const { halfDay, increment } = this.isRealHalfDay(range.start, range.end);

            if (workingDays.length === 1 && halfDay) {
                daysOffTotal += 0.5;
            } else {
                daysOffTotal += workingDays.length;
            }
        }

        this.daysOffMap[memberId] = daysOffTotal;

        const trainingDays = await this.getTrainingDaysByMember(memberId, start, end);
        this.trainingMap[memberId] = trainingDays.length;
    }
}*/
// Dans VSOCapacityEventSource.ts

public async prepareCapacityAdjustments(iterationId: string): Promise<void> {
    const teamCapacities = await this.workClient.getCapacitiesWithIdentityRef(
        this.teamContext,
        iterationId
    );

    const iteration = this.iterations.find(i => i.id === iterationId);
    if (!iteration?.attributes?.startDate || !iteration?.attributes?.finishDate) {
        console.warn("❌ Dates d'itération manquantes");
        return;
    }

    const start = new Date(iteration.attributes.startDate);
    const end = new Date(iteration.attributes.finishDate);

    console.log(`[Prepare] 🔎 Analyse de l'itération ${iteration.name} (${iterationId})`);
    console.log(`[Prepare] Période : ${start.toISOString()} → ${end.toISOString()}`);
    console.log(`[Prepare] Nombre de membres à traiter : ${teamCapacities.length}`);

    for (const capacity of teamCapacities) {
        const memberId = capacity.teamMember.id;
        const displayName = capacity.teamMember.displayName;

        console.log(`\n[Prepare] --- Traitement de ${displayName} (${memberId}) ---`);

        // 1. Récupérer les jours de formation
        const trainingDays = await this.getTrainingDaysByMember(memberId, start, end);
        this.trainingMap[memberId] = trainingDays.length;

        // 2. Compter les jours de congés
        let daysOffCount = 0;
        for (const dayOff of capacity.daysOff || []) {
            const { halfDay } = this.isRealHalfDay(dayOff.start, dayOff.end);
            daysOffCount += halfDay ? 0.5 : 1;
        }
        this.daysOffMap[memberId] = daysOffCount;

        console.log(`[Prepare] Résumé ${displayName}:`);
        console.log(`→ Training days : ${trainingDays.length}`);
        console.log(`→ Days off      : ${daysOffCount}`);
    }
}


public async updateCapacitiesBasedOnTraining(iterationId: string): Promise<void> {
    const iteration = this.iterations.find(it => it.id === iterationId);
    if (!iteration?.attributes?.startDate || !iteration?.attributes?.finishDate) return;

    // 1. Calculer les jours ouvrés du sprint
    const totalWorkingDays = this.countWorkingDays(
        new Date(iteration.attributes.startDate),
        new Date(iteration.attributes.finishDate)
    );

    const DEFAULT_HOURS_PER_DAY = 6; // Capacité standard

    for (const capacity of await this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId)) {
        const memberId = capacity.teamMember.id;
        const daysOffCount = this.daysOffMap[memberId] || 0;
        const trainingCount = this.trainingMap[memberId] || 0;

        // 2. Calculer jours disponibles
        const availableDays = totalWorkingDays - daysOffCount - trainingCount;

        // 3. Calculer nouvelle capacité
        const adjustedCapacity = Math.round((availableDays / totalWorkingDays) * DEFAULT_HOURS_PER_DAY * 10) / 10;

        console.log(`Calcul pour ${capacity.teamMember.displayName}:`);
        console.log(`- Jours dans le sprint: ${totalWorkingDays}`);
        console.log(`- Jours de congés: ${daysOffCount}`);
        console.log(`- Jours de formation: ${trainingCount}`);
        console.log(`- Jours disponibles: ${availableDays}`);
        console.log(`- Nouvelle capacité: ${adjustedCapacity}h/jour`);

        // 4. Mettre à jour dans Azure DevOps
        const patch = {
            activities: [{
                capacityPerDay: adjustedCapacity,
                name: "Development"
            }],
            daysOff: capacity.daysOff || []
        };

        await this.workClient.updateCapacityWithIdentityRef(
            patch, 
            this.teamContext, 
            iterationId, 
            memberId
        );
    }
}


/*public async updateCapacitiesBasedOnTraining(iterationId: string): Promise<void> {
    const iteration = this.iterations.find(it => it.id === iterationId);
    if (!iteration?.attributes?.startDate || !iteration?.attributes?.finishDate) return;

    const start = shiftToUTC(new Date(iteration.attributes.startDate));
    const end = shiftToUTC(new Date(iteration.attributes.finishDate));

    const workingDays = getDatesInRange(start, end).filter(d => d.getDay() !== 0 && d.getDay() !== 6);
    const totalWorkingDays = workingDays.length;

    delete this.capacityMap[iterationId];
    const capacities = await this.fetchCapacities(iterationId);

    for (const capacity of capacities) {
        const memberId = capacity.teamMember.id;
        const displayName = capacity.teamMember.displayName;

        const daysOffCount = this.daysOffMap[memberId] ?? 0;
        const trainingCount = this.trainingMap[memberId] ?? 0;
        const availableDays = totalWorkingDays - daysOffCount - trainingCount;

        if (availableDays <= 0) {
            console.warn(`⚠️ ${displayName} n’a plus de jours disponibles.`);
            continue;
        }

        let original = capacity.activities?.[0]?.capacityPerDay ?? 6;
        if (original === 0) original = 6;

        if (!capacity.activities?.length) {
            capacity.activities = [{ name: "Development", capacityPerDay: original }];
        }

        const newPerDay = Math.round((original * availableDays) / totalWorkingDays);

        // 🔧 Clamp daysOff dans les limites de l'itération
        const safeDaysOff = (capacity.daysOff ?? []).map(range => {
            const clampedStart = new Date(Math.max(start.getTime(), range.start.getTime()));
            const clampedEnd = new Date(Math.min(end.getTime(), range.end.getTime()));
            if (clampedEnd < clampedStart) return null;

            const isFullDay = range.start.getUTCHours() === 0 && range.end.getUTCHours() >= 23;
            if (isFullDay) {
                clampedStart.setUTCHours(0, 0, 0, 0);
                clampedEnd.setUTCHours(23, 59, 59, 999);
            } else {
                clampedStart.setUTCHours(clampedStart.getUTCHours(), 0, 0, 0);
                clampedEnd.setUTCHours(clampedEnd.getUTCHours(), 0, 0, 0);
            }

            return { start: clampedStart, end: clampedEnd };
        }).filter(Boolean) as { start: Date, end: Date }[];

        const payload = {
            activities: capacity.activities.map(act => ({ ...act, capacityPerDay: newPerDay })),
            daysOff: safeDaysOff
        };

        await this.workClient.updateCapacityWithIdentityRef(payload, this.teamContext, iterationId, memberId);
        console.log(`✅ PATCH capacity ${displayName} → ${newPerDay}/jour | daysOff=${safeDaysOff.length}`);
    }

    console.log("🎯 Capacités mises à jour avec succès !");
}*/


    
    
}
