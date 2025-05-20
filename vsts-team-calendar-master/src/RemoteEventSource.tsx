import { IExtensionDataManager, ExtensionDataCollection } from "azure-devops-extension-api";
import { getClient } from "azure-devops-extension-api";
import { TeamSettingsIteration, WorkRestClient } from "azure-devops-extension-api/Work";
import { EventInput } from "@fullcalendar/core";
import { EventSourceError } from "@fullcalendar/core/structs/event-source";

import { ObservableArray } from "azure-devops-ui/Core/Observable";

import { ICalendarEvent, IEventIcon, IEventCategory } from "./Contracts";
import { formatDate, shiftToUTC, shiftToLocal, getMonthYearInRange } from "./TimeLib";

export const RemoteId = "Remote";

export class RemoteEventSource {
    private teamContext: {
        projectId: string;
        project: string;
        teamId: string;
        team: string;
    } = { projectId: "", project: "", teamId: "", team: "" };

    private workClient: WorkRestClient = getClient(WorkRestClient);
    private iterations: TeamSettingsIteration[] = [];
    
    private eventMap: { [id: string]: ICalendarEvent } = {};
    private groupedEventMap: { [date: string]: ICalendarEvent } = {};
    private fetchedCollections: { [key: string]: boolean } = {};
    private dataManager?: IExtensionDataManager;
    private hostUrl: string = "https://dev.azure.com";

    public summaryData: ObservableArray<IEventCategory> = new ObservableArray<IEventCategory>([]);

    public async initialize(
        projectId: string,
        projectName: string,
        teamId: string,
        teamName: string,
        hostUrl: string,
        manager: IExtensionDataManager
    ): Promise<void> {
        this.dataManager = manager;
        this.hostUrl = hostUrl;
    
        this.teamContext = {
            project: projectName,
            projectId,
            team: teamName,
            teamId
        };
    
        this.eventMap = {};
        this.groupedEventMap = {};
        this.fetchedCollections = {}; 
        this.summaryData.value = [];
    
        this.iterations = [];
        await this.fetchIterations();
    }
    
    
    private fetchIterations = (): Promise<TeamSettingsIteration[]> => {
        if (this.iterations.length > 0) {
            return Promise.resolve(this.iterations);
        }
        return this.workClient.getTeamIterations(this.teamContext).then(result => {
            this.iterations = result;
            return result;
        });
    };
    
    
    
    
    public addEvent = async (
        startDate: Date,
        endDate: Date,
        isHalfDay: boolean,
        memberName: string,
        memberId: string,
        halfDayType?: "AM" | "PM"
    ): Promise<ICalendarEvent> => {
        // Les dates sont déjà normalisées + converties en UTC depuis le dialog, donc on les utilise telles quelles
        const utcStart = new Date(startDate);
        const utcEnd = new Date(endDate);
    
        // Clés de regroupement : on prend le début (normalisé à minuit UTC)
        const normalized = new Date(utcStart);
        normalized.setUTCHours(0, 0, 0, 0);
        const dateKey = formatDate(normalized, "YYYY-MM-DD");
    
        const id = `${memberId}_${Date.now()}`;
        const event: ICalendarEvent = {
            id,
            category: "Remote",
            title: "Remote",
            startDate: utcStart.toISOString(),
            endDate: utcEnd.toISOString(),
            halfDay: isHalfDay ? halfDayType : undefined,
            member: { id: memberId, displayName: memberName },
            icons: []
        };
    
        const icon: IEventIcon = {
            linkedEvent: event,
            src: `${this.hostUrl}/_apis/GraphProfile/MemberAvatars/${memberId}?size=small`
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
    
        this.eventMap[id] = event;
    
        const localCollectionDate = new Date(utcStart.getUTCFullYear(), utcStart.getUTCMonth(), utcStart.getUTCDate());
        const collection = `${this.teamContext.teamId}.${formatDate(localCollectionDate, "MM-YYYY")}`;
    
        //  LOGS DEBUG COMPLETS
        console.log("[REMOTE:addEvent] - START");
        console.log(" Member:", memberName, memberId);
        console.log(" DateKey:", dateKey);
        console.log("Collection:", collection);
        console.log(" Start UTC:", utcStart.toISOString());
        console.log(" End UTC:", utcEnd.toISOString());
        console.log(" Event Object:", event);
    
        await this.dataManager!.createDocument(collection, event);
    
        return event;
    };
    

    public updateEvent = (
        oldEvent: ICalendarEvent,
        startDate: Date,
        endDate: Date,
        isHalfDay: boolean,
        memberName: string,
        memberId: string,
        halfDayType?: "AM" | "PM"
    ): Promise<ICalendarEvent> => {
        const originalStart = new Date(oldEvent.startDate);
        const oldCollection = `${this.teamContext.teamId}.${formatDate(originalStart, "MM-YYYY")}`;
        const newCollection = `${this.teamContext.teamId}.${formatDate(startDate, "MM-YYYY")}`;

        if (halfDayType === "AM") {
            startDate.setHours(9, 0, 0, 0);
            endDate.setHours(12, 0, 0, 0);
        } else if (halfDayType === "PM") {
            startDate.setHours(14, 0, 0, 0);
            endDate.setHours(18, 0, 0, 0);
        }

        oldEvent.startDate = shiftToUTC(startDate).toISOString();
        oldEvent.endDate = shiftToUTC(endDate).toISOString();
        oldEvent.halfDay = halfDayType;
        oldEvent.member = { id: memberId, displayName: memberName };
        oldEvent.icons = [
            {
                src: `${this.hostUrl}/_apis/GraphProfile/MemberAvatars/${memberId}?size=small`,
                linkedEvent: oldEvent
            }
        ];

        if (oldCollection === newCollection) {
            return this.dataManager!
                .updateDocument(newCollection, oldEvent)
                .then(updated => {
                    this.eventMap[updated.id!] = updated;
                    return updated;
                });
        } else {
            return this.dataManager!
                .deleteDocument(oldCollection, oldEvent.id!)
                .then(() =>
                    this.dataManager!
                        .createDocument(newCollection, oldEvent)
                        .then(updated => {
                            this.eventMap[updated.id!] = updated;
                            return updated;
                        })
                );
        }
    };

   
    public deleteEvent = (event: ICalendarEvent): Promise<void> => {
        const collection = `${this.teamContext.teamId}.${formatDate(new Date(event.startDate), "MM-YYYY")}`;
    
        //  Supprimer de eventMap
        delete this.eventMap[event.id!];
    
        //  Supprimer de groupedEventMap
        const dateKey = formatDate(shiftToUTC(new Date(event.startDate)), "YYYY-MM-DD");
        const grouped = this.groupedEventMap[dateKey];
        if (grouped?.icons) {
            grouped.icons = grouped.icons.filter(icon => icon.linkedEvent.id !== event.id);
            if (grouped.icons.length === 0) {
                delete this.groupedEventMap[dateKey];
            }
        }
    
        //  Recalculer summaryData (important pour ne pas dupliquer l’affichage)
        this.summaryData.splice(0, this.summaryData.length);
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    
        // Regénérer les événements pour le mois courant (c'est suffisant pour résumé)
        this.getEvents(
            {
                start: currentMonthStart,
                end: nextMonthStart,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            () => {}, // pas besoin de traiter la liste ici
            (err) => console.error("[Remote:deleteEvent] Refresh summary error:", err)
        );
    
        return this.dataManager!.deleteDocument(collection, event.id!);
    };
    

    public getEvents = (
        arg: { start: Date; end: Date; timeZone: string },
        successCallback: (events: EventInput[]) => void,
        failureCallback: (error: EventSourceError) => void
    ): void => {
        const start = arg.start;
        const end = new Date(arg.end);
        end.setDate(end.getDate() - 1);
    
        const summaryMap: { [id: string]: IEventCategory & { __days?: { [date: string]: true } } } = {};
        const events: EventInput[] = [];
    
        this.summaryData.splice(0, this.summaryData.length);
        this.groupedEventMap = {};
    
        this.fetchEvents(start, end).then(() => {
            for (const id in this.eventMap) {
                const raw = this.eventMap[id];
                if (!raw.member?.displayName || raw.member.displayName === "Remote") {
                    console.warn(" Event with invalid member name:", raw);
                    continue; //  Ignore les remotes mal formés
                    
                }
                const memberName = raw.member.displayName;
    
                //  NE PAS faire shiftToLocal ici
                const eventStart = new Date(raw.startDate);
                const eventEnd = new Date(raw.endDate);
    
                const isHalfDay = raw.halfDay === "AM" || raw.halfDay === "PM";
                const adjustedEnd = new Date(eventEnd);
                if (!isHalfDay) adjustedEnd.setDate(adjustedEnd.getDate() + 1);
    
                if (
                    (start <= eventStart && eventStart <= end) ||
                    (start <= eventEnd && eventEnd <= end)
                ) {
                    events.push({
                        id: `${RemoteId}.${id}`,
                        title: "Remote",
                        start: eventStart,
                        end: adjustedEnd,
                        allDay: !isHalfDay,
                        editable: true,
                        color: "#7E57C2",
                        extendedProps: {
                            id: raw.id,
                            member: raw.member,
                            halfDay: raw.halfDay,
                            startDate: raw.startDate,
                            endDate: raw.endDate
                        }
                    });
    
                    const normalized = shiftToUTC(eventStart);
                    normalized.setUTCHours(0, 0, 0, 0);
                    const dateKey = formatDate(normalized, "YYYY-MM-DD");
    
                    console.log("[REMOTE:getEvents] raw startDate:", raw.startDate);
                    console.log("[REMOTE:getEvents] raw endDate:", raw.endDate);
                    console.log("[REMOTE:getEvents] parsed eventStart:", eventStart.toISOString());
                    console.log("[REMOTE:getEvents] parsed eventEnd:", eventEnd.toISOString());
                    console.log("[REMOTE:getEvents] isHalfDay:", isHalfDay);
                    console.log("[REMOTE:getEvents] dateKey:", dateKey);
    
                    const icon: IEventIcon = {
                        linkedEvent: raw,
                        src: `${this.hostUrl}/_apis/GraphProfile/MemberAvatars/${raw.member?.id}?size=small`
                    };
    
                    if (!this.groupedEventMap[dateKey]) {
                        this.groupedEventMap[dateKey] = { ...raw, icons: [icon] };
                    } else {
                        const exists = this.groupedEventMap[dateKey].icons?.some(
                            i =>
                                i.linkedEvent.member?.id === raw.member?.id &&
                                new Date(i.linkedEvent.startDate).getTime() === new Date(raw.startDate).getTime()
                        );
                        if (!exists) this.groupedEventMap[dateKey].icons!.push(icon);
                    }
    
                    const memberName = (raw.member?.displayName && raw.member.displayName !== "Remote")
    ? raw.member.displayName
    : "Unknown"; // ou filtre complètement

                    const increment = isHalfDay ? 0.5 : 1;
                    if (!summaryMap[memberName]) {
                        summaryMap[memberName] = {
                            title: memberName,
                            color: "#7E57C2",
                            eventCount: increment,
                            subTitle: "",
                            __days: { [dateKey]: true }
                        };
                    } else {
                        if (!summaryMap[memberName].__days![dateKey]) {
                            summaryMap[memberName].eventCount += increment;
                            summaryMap[memberName].__days![dateKey] = true;
                        }
                    }
                }
            }
    
            for (const name in summaryMap) {
                const entry = summaryMap[name];
                const rounded = Number(entry.eventCount.toFixed(1));
                this.summaryData.push({
                    title: entry.title,
                    color: entry.color,
                    eventCount: rounded,
                    subTitle: `${rounded} day${rounded !== 1 ? "s" : ""} remote`
                });
            }
    
            successCallback(events);
        }).catch(failureCallback);
    };
    
    public getGroupedEventForDate(date: Date): ICalendarEvent | undefined {
        const d = new Date(date);
        d.setUTCHours(0, 0, 0, 0);
        const key = formatDate(d, "YYYY-MM-DD");
        return this.groupedEventMap[key];
    }

    public getSummaryData(): ObservableArray<IEventCategory> {
        return this.summaryData;
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
    

    public fetchEvents = (start: Date, end: Date): Promise<{ [id: string]: ICalendarEvent }> => {
        const months = getMonthYearInRange(start, end);
        const fetchList: string[] = [];

        for (let i = 0; i < months.length; i++) {
            const collection = `${this.teamContext.teamId}.${months[i]}`;
            if (!this.fetchedCollections[collection]) {
                fetchList.push(collection);
                this.fetchedCollections[collection] = true;
            }
        }

        return this.dataManager!.queryCollectionsByName(fetchList).then((collections: ExtensionDataCollection[]) => {
            for (let c = 0; c < collections.length; c++) {
                const col = collections[c];
                if (col && col.documents) {
                    for (let d = 0; d < col.documents.length; d++) {
                        const doc = col.documents[d] as ICalendarEvent;
                        this.eventMap[doc.id!] = doc;
                    }
                }
            }
            return this.eventMap;
        });
    };
}
