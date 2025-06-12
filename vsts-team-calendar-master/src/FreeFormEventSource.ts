import { IExtensionDataManager, ExtensionDataCollection } from "azure-devops-extension-api";

import { ObservableArray } from "azure-devops-ui/Core/Observable";

import { EventInput } from "@fullcalendar/core";
import { EventSourceError } from "@fullcalendar/core/structs/event-source";

import { generateColor } from "./Color";
import { ICalendarEvent, IEventCategory } from "./Contracts";
import { shiftToLocal, shiftToUTC, getMonthYearInRange, formatDate } from "./TimeLib";

export const FreeFormId = "FreeForm";

export class FreeFormEventsSource {
    categories: Set<string> = new Set<string>();
    members?: { identity: { id: string; displayName: string } }[]; // Add members property
    dataManager?: IExtensionDataManager;
    eventMap: { [id: string]: ICalendarEvent } = {};
    fetchedCollections: Set<string> = new Set<string>();
    selectedTeamId: string = "";
    summaryData: ObservableArray<IEventCategory> = new ObservableArray<IEventCategory>([]);
    hostUrl: string = "https://dev.azure.com";

    public addEvent = (
        title: string,
        startDate: Date,
        endDate: Date,
       
        description: string,
        halfDayType: "AM" | "PM" | undefined,
        memberId: string
    ): PromiseLike<ICalendarEvent> => {
    
        // Ajustement des heures si halfDay
        if (halfDayType === "AM") {
            startDate.setHours(9, 0, 0);
            endDate.setHours(12, 0, 0);
        } else if (halfDayType === "PM") {
            startDate.setHours(14, 0, 0);
            endDate.setHours(18, 0, 0);
        }
    
        const start = shiftToUTC(startDate);
        const end = shiftToUTC(endDate);
    
        const event: ICalendarEvent = {
           
            category: "Training", // valeur fixe, toujours "Training"
            
            description: description,
            endDate: end.toISOString(),
            startDate: start.toISOString(),
            title: title,
            halfDay: halfDayType,
           // member: { id: memberId, displayName: "" }, 
           member: {
            id: memberId,
            displayName: this.getMemberDisplayName(memberId)
        },
            icons: []
        };
    
      
        if (typeof event.category !== "string") {
            event.category = event.category.title;
        }
      
    
        // Ajout d'une icône liée au membre
        const safeLinkedEvent: ICalendarEvent = {
            id: event.id, // ou undefined si pas encore généré
            title: event.title,
            startDate: event.startDate,
            endDate: event.endDate,
            halfDay: event.halfDay,
            category: event.category ?? "Training", //  Ajout de category obligatoire
            member: event.member,
            description: "", // ou event.description si utile
            icons: [] 
        };
        
        event.icons = [
            {
                src: `${this.hostUrl}/_apis/GraphProfile/MemberAvatars/${memberId}?size=small`,
                linkedEvent: safeLinkedEvent
            }
        ];
        
    
        return this.dataManager!.createDocument(
            this.selectedTeamId! + "." + formatDate(startDate, "MM-YYYY"),
            event
        ).then((addedEvent: ICalendarEvent) => {
            this.eventMap[addedEvent.id!] = addedEvent;
            addedEvent.startDate = start.toISOString();
            addedEvent.endDate = end.toISOString();
            return addedEvent;
        });
    };
    
    public setMembers(members: { identity: { id: string; displayName: string } }[]) {
        this.members = members;
    }
    
    public deleteEvent = (eventId: string, startDate: Date) => {
        delete this.eventMap[eventId];
        return this.dataManager!.deleteDocument(this.selectedTeamId! + "." + formatDate(startDate, "MM-YYYY"), eventId);
    };

    public getCategories = (): Set<string> => {
        return this.categories;
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
        // convert end date to inclusive end date
        const calendarStart = arg.start;
        const calendarEnd = new Date(arg.end);
        calendarEnd.setDate(arg.end.getDate() - 1);
    
        this.fetchEvents(calendarStart, calendarEnd).then(() => {
            const inputs: EventInput[] = [];
            const catagoryMap: { [id: string]: IEventCategory } = {};
            const summaryList: IEventCategory[] = [];
    
            Object.keys(this.eventMap).forEach(id => {
                const event = this.eventMap[id];
    
                //  Ne pas traiter les Remote ici
                
                if (event.category === "Remote") return;
    
                // skip events with date strings we can't parse.
                if (Date.parse(event.startDate) && event.endDate && Date.parse(event.endDate)) {
                    if (event.category && typeof event.category !== "string") {
                        event.category = event.category.title;
                    }
                
    
                    const start = shiftToLocal(new Date(event.startDate));
                    const end = shiftToLocal(new Date(event.endDate));
    
                    // check if event should be shown
                    if ((calendarStart <= start && start <= calendarEnd) || (calendarStart <= end && end <= calendarEnd)) {
                        const excludedEndDate = new Date(end);
                        excludedEndDate.setDate(end.getDate() + 1);
    
                        const eventColor = generateColor(event.category);
    
                        inputs.push({
                            id: FreeFormId + "." + event.id,
                            allDay: !event.halfDay,
                            editable: true,
                            start: start,
                            end: event.halfDay
                                ? end
                                : (() => {
                                    const ex = new Date(end);
                                    ex.setDate(end.getDate() + 1);
                                    return ex;
                                })(),
                            title: event.title,
                            color: eventColor,
                            extendedProps: {
                                category: event.category,
                                description: event.description,
                                id: event.id,
                                halfDay: event.halfDay,
                                member: event.member
                            }
                        });
    
                        if (catagoryMap[event.category]) {
                            catagoryMap[event.category].eventCount++;
                        } else {
                            catagoryMap[event.category] = {
                                color: eventColor,
                                eventCount: 1,
                                subTitle: event.title,
                                title: event.category
                            };
                        }
                    }
                }
            });
    
            Object.keys(catagoryMap).forEach(key => {
                const catagory = catagoryMap[key];
                if (catagory.eventCount > 1) {
                    catagory.subTitle = catagory.eventCount + " events";
                }
                summaryList.push(catagory);
            });
    
            successCallback(inputs);
            this.summaryData.value = summaryList;
        });
    };
    
    public getSummaryData = (): ObservableArray<IEventCategory> => {
        return this.summaryData;
    };

    public initialize(teamId: string, manager: IExtensionDataManager) {
        this.selectedTeamId = teamId;
        this.dataManager = manager;
        this.eventMap = {};
        this.categories.clear();
        this.fetchedCollections.clear();
    }

    public updateEvent = (
        id: string,
        title: string,
        startDate: Date,
        endDate: Date,
        
        description: string,
        halfDay?: "AM" | "PM"
    ): PromiseLike<ICalendarEvent> => {
        const oldEvent = this.eventMap[id];
        const oldStartDate = new Date(oldEvent.startDate);

        
        oldEvent.description = description;
        if (halfDay === "AM") {
            startDate.setHours(8, 0, 0);
            endDate.setHours(12, 0, 0);
        } else if (halfDay === "PM") {
            startDate.setHours(13, 0, 0);
            endDate.setHours(17, 0, 0);
        }
        
        
        oldEvent.endDate = shiftToUTC(endDate).toISOString();
        oldEvent.startDate = shiftToUTC(startDate).toISOString();
        oldEvent.title = title;
        oldEvent.halfDay = halfDay;

        const collectionNameOld = this.selectedTeamId! + "." + formatDate(oldStartDate, "MM-YYYY");
        const collectionNameNew = this.selectedTeamId! + "." + formatDate(startDate, "MM-YYYY");

        if (collectionNameOld == collectionNameNew) {
            return this.dataManager!.updateDocument(collectionNameNew, oldEvent).then((updatedEvent: ICalendarEvent) => {
                // add event
                this.eventMap[updatedEvent.id!] = updatedEvent;
                return updatedEvent;
            });
        } else {
            // move data to new month's collection
            return this.dataManager!.deleteDocument(collectionNameOld, oldEvent.id!).then(() => {
                return this.dataManager!.createDocument(collectionNameNew, oldEvent).then((updatedEvent: ICalendarEvent) => {
                    // add event
                    this.eventMap[updatedEvent.id!] = updatedEvent;
                    return updatedEvent;
                });
            });
        }
    };

    /**
     * Copies legqacy data from single collection in to respective monthly collection
     * Deletes legacy data
     */
    private convertData = (oldData: ICalendarEvent[]) => {
        // chain all actions in to max 10 queues
        let queue: Promise<void>[] = [];
        const maxSize = oldData.length < 10 ? oldData.length : 10;

        let index: number;
        for (index = 0; index < maxSize; index++) {
            queue[index] = Promise.resolve();
        }

        // create new event and delete old one
        oldData.forEach(doc => {
            if (index === maxSize) {
                index = 0;
            }
            queue[index] = queue[index].then(() => {
                this.dataManager!.createDocument(this.selectedTeamId! + "." + formatDate(new Date(doc.startDate), "MM-YYYY"), doc);
            });
            queue[index] = queue[index].then(() => {
                this.dataManager!.deleteDocument(this.selectedTeamId!, doc.id!);
            });
            index++;
        });

        // delete catagories data if there is any
        this.dataManager!.queryCollectionsByName([this.selectedTeamId! + "-categories"]).then((collections: ExtensionDataCollection[]) => {
            if (collections && collections[0] && collections[0].documents) {
                collections[0].documents.forEach(doc => {
                    if (index === maxSize) {
                        index = 0;
                    }
                    queue[index] = queue[index].then(() => {
                        this.dataManager!.deleteDocument(this.selectedTeamId! + "-categories", doc.id!);
                    });
                    index++;
                });
            }
        });
    };
    private getMemberDisplayName(memberId: string): string {
        const member = this.members?.find(m => m.identity.id === memberId);
        return member?.identity.displayName || "Unknown";
    }
    
    private fetchEvents = (start: Date, end: Date): Promise<{ [id: string]: ICalendarEvent }> => {
        const collectionNames = getMonthYearInRange(start, end).map(item => {
            return this.selectedTeamId! + "." + item;
        });
    
        const collectionsToFetch: string[] = [];
        collectionNames.forEach(collection => {
            if (!this.fetchedCollections.has(collection)) {
                collectionsToFetch.push(collection);
                this.fetchedCollections.add(collection);
            }
        });
    
        return this.dataManager!.queryCollectionsByName(collectionsToFetch).then((collections: ExtensionDataCollection[]) => {
            collections.forEach(collection => {
                if (collection && collection.documents) {
                    collection.documents.forEach(doc => {
                        //  NE PAS charger les Remote dans FreeForm
                        if (doc.category !== "Remote") {
                            this.eventMap[doc.id] = doc;
                        }
                    });
                }
            });
    
            // legacy fallback
            if (!this.fetchedCollections.has(this.selectedTeamId!)) {
                return this.dataManager!.queryCollectionsByName([this.selectedTeamId!]).then((collections: ExtensionDataCollection[]) => {
                    this.fetchedCollections.add(this.selectedTeamId!);
                    if (collections && collections[0] && collections[0].documents) {
                        const oldData: ICalendarEvent[] = [];
                        collections[0].documents.forEach((doc: ICalendarEvent) => {
                            if (doc.category !== "Remote") {
                                this.eventMap[doc.id!] = doc;
                                oldData.push(doc);
                            }
                        });
                        this.convertData(oldData);
                    }
                    return this.eventMap;
                });
            }
    
            return Promise.resolve(this.eventMap);
        });
    };
    
    public async clearStoredEvents(): Promise<void> {
        if (!this.dataManager || !this.selectedTeamId) return;
    
        const now = new Date();
        const monthsToWipe = 24;
    
        try {
            for (let i = 0; i < monthsToWipe; i++) {
                const date = new Date(now.getFullYear(), now.getMonth() - i);
                const mm = ("0" + (date.getMonth() + 1)).slice(-2);
                const yyyy = date.getFullYear();
                const collectionName = `${this.selectedTeamId}.${mm}-${yyyy}`;
    
                try {
                    const docs = await this.dataManager.getDocuments(collectionName, {
                        scopeType: "User",
                        defaultValue: []
                    });
    
                    for (const doc of docs) {
                        if (doc.id !== "$settings") {
                            await this.dataManager.deleteDocument(collectionName, doc.id!, {
                                scopeType: "User"
                            });
                        }
                    }
    
                   // console.log(` Collection nettoyée : ${collectionName}`);
                } catch (err) {
                    const status = (err as any)?.status;
                    if (status !== 404) {
                        console.error(` Erreur suppression collection ${collectionName}`, err);
                    }
                }
            }
    
            const catName = `${this.selectedTeamId}-categories`;
            try {
                const docs = await this.dataManager.getDocuments(catName, {
                    scopeType: "User",
                    defaultValue: []
                });
    
                for (const doc of docs) {
                    await this.dataManager.deleteDocument(catName, doc.id!, {
                        scopeType: "User"
                    });
                }
    
               // console.log(` Collection catégories nettoyée : ${catName}`);
            } catch (err) {
                const status = (err as any)?.status;
                if (status !== 404) {
                    console.error(` Erreur suppression catégories`, err);
                }
            }
    
            this.eventMap = {};
            this.fetchedCollections.clear();
            this.categories.clear();
    
        } catch (err) {
            console.error(" clearStoredEvents global failure:", err);
        }
    }
    //TrainingVersion
    public async getEventsAsync(arg: {
        start: Date;
        end: Date;
        timeZone: string;
    }): Promise<EventInput[]> {
        return new Promise<EventInput[]>((resolve, reject) => {
            this.getEvents(arg, resolve, reject);
        });
    }
    
    
    
    
}