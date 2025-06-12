import { WorkRestClient, TeamMemberCapacityIdentityRef } from "azure-devops-extension-api/Work";
import { TeamContext } from "azure-devops-extension-api/Core";
import { shiftToUTC } from "./TimeLib";
import { ICalendarEvent } from "./Contracts";
import { FreeFormEventsSource } from "./FreeFormEventSource";

interface TimeRange {
    start: Date;
    end: Date;
}

export class CapacityAutoUpdaterService {
    constructor(
        private workClient: WorkRestClient,
        private teamContext: TeamContext,
        private freeForm: FreeFormEventsSource
    ) {}

    public async syncAllCapacity(iterationId: string, iterationStart: Date, iterationEnd: Date): Promise<void> {
        console.log(` [syncAllCapacity] Début de la synchronisation pour l'itération : ${iterationId}`);
    
        if (!this.teamContext?.project || !this.teamContext?.team) {
            console.error(" teamContext incomplet :", this.teamContext);
            return;
        }
    
        try {
            //  Récupération des capacités actuelles
            const capacities = await this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId);
            const trainings = this.getTrainingsInRange(iterationStart, iterationEnd);
    
            for (const capacity of capacities) {
                const userId = capacity.teamMember.id;
                const displayName = capacity.teamMember.displayName;
    
                const trainingRanges = trainings[userId] || [];
                const originalDaysOff = capacity.daysOff ?? [];
    
                const merged = this.mergeRanges(originalDaysOff, trainingRanges);
                const shouldUpdate = merged.length !== originalDaysOff.length;
    
                if (shouldUpdate) {
                    const payload = {
                        activities: capacity.activities && capacity.activities.length > 0
                            ? capacity.activities
                            : [{ name: "Development", capacityPerDay: 6 }], // fallback
    
                        daysOff: merged.map(d => ({
                            start: shiftToUTC(d.start),
                            end: shiftToUTC(d.end)
                        }))
                    };
    
                    // 🔍 Debug log complet
                    console.log(` [POSTMAN TEST] PATCH https://dev.azure.com/${this.teamContext.project}/_apis/work/teamsettings/capacity/${userId}?iterationId=${iterationId}&api-version=7.1-preview.1`);
                    console.log(" Request Body:", JSON.stringify(payload, null, 2));
    
                    //  Patch avec sécurité
                    try {
                        await this.workClient.updateCapacityWithIdentityRef(payload, this.teamContext, iterationId, userId);
                        console.log(` [CapacityAutoUpdater] Capacité mise à jour pour ${displayName}`);
                    } catch (apiError) {
                        console.error(` PATCH échoué pour ${displayName} (${userId})`, apiError);
                    }
                } else {
                    console.log(` Aucun changement de capacité pour ${displayName}`);
                }
            }
    
            console.log(" [syncAllCapacity] Terminé avec succès !");
        } catch (e) {
            console.error(" Erreur générale dans syncAllCapacity :", e);
        }
    }
    

    private getTrainingsInRange(start: Date, end: Date): Record<string, TimeRange[]> {
        const result: Record<string, TimeRange[]> = {};
        const events = [];
        for (const key in this.freeForm.eventMap) {
            if (this.freeForm.eventMap.hasOwnProperty(key)) {
            events.push(this.freeForm.eventMap[key]);
            }
        }

        for (const e of events) {
            if (e.category !== "Training" || !e.member) continue;

            const eventStart = new Date(e.startDate);
            const eventEnd = new Date(e.endDate);
            if (eventEnd < start || eventStart > end) continue;

            const userId = e.member.id;
            if (!result[userId]) result[userId] = [];

            result[userId].push({ start: eventStart, end: eventEnd });
        }

        return result;
    }

    private mergeRanges(
        original: { start: Date; end: Date }[],
        additional: TimeRange[]
    ): { start: Date; end: Date }[] {
        const merged: { start: Date; end: Date }[] = [...original];

        for (const add of additional) {
            const exists = merged.some(
                d => d.start.getTime() === add.start.getTime() && d.end.getTime() === add.end.getTime()
            );
            if (!exists) {
                merged.push(add);
            }
        }

        return merged;
    }
}
