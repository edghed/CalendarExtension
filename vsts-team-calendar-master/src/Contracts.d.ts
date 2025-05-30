/* This code snippet is defining TypeScript interfaces for a calendar event system. Here's a breakdown of what each interface represents: */
/**
 * Represents a single calendar event
 */
export interface ICalendarEvent {
    /**
     * Used by collection to
     */
    __etag?: number;

    /**
     * Category of the service
     */
    category: string | IEventCategory;

    /**
     * A description of the event
     */
    description?: string;

    /**
     * Event end date
     */
    endDate: string;

     /**
     * Indicates if this event is for a half-day only
     * "AM" for morning, "PM" for afternoon
     */
     halfDay?: "AM" | "PM";

    /**
     * Icons to be displayed on the event
     */
    icons: IEventIcon[];

    /**
     * Unique id for the event
     */
    id?: string;
    

    /**
     * Id of the iteration to which the event is linked
     * (previous version of calendear allowed days off to be in wrong iteration)
     */
    iterationId?: string;

    /**
     * The member associated with this event
     */
    member?: ICalendarMember;

    /**
     * Event start date
     */
    startDate: string;

    /**
     * Title of the event
     */
    title: string;
}

export interface ICalendarMember {
    /**
     * Display name of the member
     */
    displayName: string;

    /**
     * Unique ID for the member
     */
    id: string;
}

/**
 * Summary item for events
 */
export interface IEventCategory {
    /**
     * Color of the category
     */
    color?: string;

    /**
     * Number of event under this Category
     */
    eventCount: number;

    /**
     * Image url of the category
     */
    imageUrl?: string;

    /**
     * Sub title of the event category
     */
    subTitle?: string;

    /**
     * Title of the event category
     */
    title: string;
}

/**
 * An icon displayed on the calendar representing an event
 */
export interface IEventIcon {
    /**
     * The event to edit or delete when the icon is selected
     */
    linkedEvent: ICalendarEvent;

    /**
     * src url for the icon
     */
    src: string;
}
