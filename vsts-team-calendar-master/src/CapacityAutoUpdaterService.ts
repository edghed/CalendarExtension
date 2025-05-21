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
        const capacities = await this.workClient.getCapacitiesWithIdentityRef(this.teamContext, iterationId);
        const trainings = this.getTrainingsInRange(iterationStart, iterationEnd);

        for (const capacity of capacities) {
            const userId = capacity.teamMember.id;

            const trainingRanges = trainings[userId] || [];
            const originalDaysOff = capacity.daysOff;

            const merged = this.mergeRanges(originalDaysOff, trainingRanges);

            const shouldUpdate = merged.length !== originalDaysOff.length;

            if (shouldUpdate) {
                await this.workClient.updateCapacityWithIdentityRef({
                    activities: capacity.activities,
                    daysOff: merged.map(d => ({
                        start: shiftToUTC(d.start),
                        end: shiftToUTC(d.end)
                    }))
                }, this.teamContext, iterationId, userId);

                console.log(`[CapacityAutoUpdater] Capacity updated for ${capacity.teamMember.displayName}`);
            }
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
