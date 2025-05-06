import { ICalendarEvent, IEventIcon } from "./Contracts";

export interface IDaysOffGroupedEvent extends ICalendarEvent   {
    AM?: ICalendarEvent[];  // Événements pour la demi-journée AM
    PM?: ICalendarEvent[];  // Événements pour la demi-journée PM
    fullDay?: ICalendarEvent[];  // Événements pour une journée complète
    icons: IEventIcon[]; 
       // Liste des icônes associées à la journée
}