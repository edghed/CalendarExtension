import React = require("react");

import { TeamMember } from "azure-devops-extension-api/WebApi/WebApi";
import { getUser } from "azure-devops-extension-sdk";

import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { CustomDialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { TitleSize } from "azure-devops-ui/Header";
import { IListSelection } from "azure-devops-ui/List";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { Observer } from "azure-devops-ui/Observer";
import { PanelHeader, PanelFooter, PanelContent } from "azure-devops-ui/Panel";
import { TeamSettingsIteration } from "azure-devops-extension-api/Work";

import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { EditableDropdown } from "azure-devops-ui/EditableDropdown";

import { Calendar } from "@fullcalendar/core";
import { ICalendarEvent } from "./Contracts";
import { formatDate, shiftToUTC, toDate } from "./TimeLib";
import { RemoteEventSource } from "./RemoteEventSource";

interface IAddEditRemoteDialogProps {
    calendarApi: Calendar;
    start: Date;
    end: Date;
    members: TeamMember[];
    event?: ICalendarEvent;
    onDismiss: () => void;
    dialogTitle?: string;
    eventSource: RemoteEventSource;
}

export class AddEditRemoteDialog extends React.Component<IAddEditRemoteDialogProps> {
    startDate: Date;
    endDate: Date;
    iteration?: TeamSettingsIteration;

    isHalfDay = new ObservableValue<boolean>(false);
    halfDayType = new ObservableValue<"AM" | "PM" | undefined>(undefined);
    message = new ObservableValue<string>("");
    okButtonEnabled = new ObservableValue<boolean>(true);

    teamMembers: IListBoxItem[] = [];
    memberSelection: IListSelection = new DropdownSelection();
    selectedMemberId: string;
    selectedMemberName: string;
    


    constructor(props: IAddEditRemoteDialogProps) {
        super(props);

        const userName = getUser().displayName;
        let selectedIndex = 0;
        if (!this.props.eventSource) {
            console.error("❌ RemoteEventSource not passed to AddEditRemoteDialog");
        }
        
        if (props.event) {
            this.startDate = new Date(props.event.startDate);
         

            this.endDate = new Date(props.event.endDate);
            this.validateSelections();

            this.isHalfDay.value = !!props.event.halfDay;
            this.halfDayType.value = props.event.halfDay ?? undefined;
            this.teamMembers.push({ id: props.event.member!.id, text: props.event.member!.displayName });
        } else {
            this.startDate = props.start;
            this.endDate = props.end;
            this.teamMembers = props.members.map(m => ({
                id: m.identity.id,
                text: m.identity.displayName
            }));
            
        }

        this.memberSelection.select(selectedIndex);
        this.selectedMemberId = this.teamMembers[selectedIndex]?.id ?? "";
        this.selectedMemberName = this.teamMembers[selectedIndex]?.text ?? "";
        this.iteration = this.props.eventSource.getIterationForDate(this.startDate, this.endDate);


        this.validate();
    }

    public render(): JSX.Element {
        return (
            <CustomDialog onDismiss={this.props.onDismiss}>
                <PanelHeader
                    onDismiss={this.props.onDismiss}
                    showCloseButton={false}
                    titleProps={{
                        size: TitleSize.Small,
                        text: this.props.dialogTitle ?? (this.props.event ? "Edit Remote Work" : "Add Remote Work")
                    }}
                />
                <PanelContent>
                    <div className="flex-grow flex-column event-dialog-content">
                        <Observer message={this.message}>
                            {(props: { message: string }) =>
                                props.message ? (
                                    <MessageCard className="flex-self-stretch" severity={MessageCardSeverity.Info}>
                                        {props.message}
                                    </MessageCard>
                                ) : null
                            }
                        </Observer>

                        <div className="input-row flex-row">
                            <span>Start Date</span>
                            <div className="bolt-textfield column-2">
                            <input
                                    className="bolt-textfield-input input-date"
                                    value={formatDate(this.startDate, "YYYY-MM-DD")}
                                    onChange={this.onInputStartDate}
                                    type="date"
                                />

                            </div>
                        </div>

                        <div className="input-row flex-row">
                            <span>End Date</span>
                            <div className="bolt-textfield column-2">
                            <input
                                                className="bolt-textfield-input input-date"
                                                value={formatDate(this.endDate, "YYYY-MM-DD")}
                                                onChange={this.onInputEndDate}
                                                type="date"
                                            />

                            </div>
                        </div>

                        <div className="input-row flex-row">
                            <span>Half Day</span>
                            <Observer value={this.halfDayType}>
                                {(props: { value: "AM" | "PM" | undefined }) => (
                                    <EditableDropdown
                                        className="column-2"
                                        items={["", "AM", "PM"]}
                                        placeholder="Select Half Day"
                                        selectedText={props.value ?? ""}
                                        onValueChange={(val?: IListBoxItem) => {
                                            this.halfDayType.value = val?.text === "" ? undefined : (val?.text as "AM" | "PM");
                                            this.isHalfDay.value = !!this.halfDayType.value;
                                            this.validate();
                                        }}
                                    />
                                )}
                            </Observer>
                        </div>

                        <div className="input-row flex-row">
                            <span>Team Member</span>
                            <Dropdown
                                className="column-2"
                                items={this.teamMembers}
                                onSelect={this.onSelectTeamMember}
                                selection={this.memberSelection}
                            />
                        </div>
                    </div>
                </PanelContent>

                <PanelFooter>
    <div className="flex-grow flex-row">
        <ButtonGroup className="bolt-panel-footer-buttons flex-grow">
            <Button onClick={this.props.onDismiss} text="Cancel" />
            <Observer enabled={this.okButtonEnabled}>
                {(props: { enabled: boolean }) => (
                    <Button disabled={!props.enabled} onClick={this.onOKClick} primary={true} text="Ok" />
                )}
            </Observer>

            {/*  Bouton delete visible uniquement si on est en édition */}
            {this.props.event && (
                <Button
                    danger={true}
                    text="Delete"
                    onClick={() => {
                        this.props.eventSource
                            .deleteEvent(this.props.event!)
                            .then(() => {
                                this.props.calendarApi.refetchEvents();
                                this.props.onDismiss();
                            })
                            .catch(err => {
                                console.error(" Failed to delete remote event:", err);
                            });
                    }}
                />
            )}
        </ButtonGroup>
    </div>
</PanelFooter>

            </CustomDialog>
        );
    }

    private onInputStartDate = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.startDate = toDate(e.target.value);
        this.halfDayType.value = undefined;
        this.isHalfDay.value = false;
        this.validateSelections();
    };
    private validateSelections = () => {
        let valid = this.startDate <= this.endDate;
    
        // Ne plus exiger une itération
        this.iteration = this.props.eventSource.getIterationForDate(this.startDate, this.endDate);
    
        const halfDayInvalid = this.isHalfDay.value && !this.halfDayType.value;
    
        if (!valid || halfDayInvalid) {
            this.okButtonEnabled.value = false;
    
            if (halfDayInvalid) {
                this.message.value = "Please select AM or PM for a half-day.";
            } else if (this.startDate > this.endDate) {
                this.message.value = "Start date must be same or before the end date.";
            }
    
            return;
        }
    
        this.message.value = "";
        this.okButtonEnabled.value = true;
    };
    

    private onInputEndDate = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.endDate = toDate(e.target.value);
        this.halfDayType.value = undefined;
        this.isHalfDay.value = false;
        this.validateSelections();
    };

    private onSelectTeamMember = (event: React.SyntheticEvent<HTMLElement>, item: IListBoxItem<{}>) => {
        this.selectedMemberId = item.id;
        this.selectedMemberName = item.text!;
    };

    private validate = () => {
        const isHalf = this.isHalfDay.value;
        const sameDay = this.startDate.toDateString() === this.endDate.toDateString();

        if (isHalf && !sameDay) {
            this.message.value = "Half-day remote must start and end on the same day.";
            this.okButtonEnabled.value = false;
        } else {
            this.message.value = "";
            this.okButtonEnabled.value = true;
        }
    };
    private onOKClick = (): void => {
        const isHalfDay = !!this.halfDayType.value;
    
        const start = new Date(this.startDate);
        const end = new Date(this.endDate);
    
        // Injecter les heures (local time) AVANT shiftToUTC
        if (isHalfDay && this.halfDayType.value) {
            if (this.halfDayType.value === "AM") {
                start.setHours(9, 0, 0, 0);
                end.setHours(12, 0, 0, 0);
            } else if (this.halfDayType.value === "PM") {
                start.setHours(14, 0, 0, 0);
                end.setHours(18, 0, 0, 0);
            }
        } else {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
        }
    
        // Convertir APRES injection des heures
        const normalizedStart = shiftToUTC(start);
        const normalizedEnd = shiftToUTC(end);
    
        console.log(" [Remote] Dates normalisées envoyées", { normalizedStart, normalizedEnd });
    
        const promise = this.props.event
            ? this.props.eventSource.updateEvent(
                this.props.event,
                normalizedStart,
                normalizedEnd,
                isHalfDay,
                this.selectedMemberName,
                this.selectedMemberId,
                this.halfDayType.value
            )
            : this.props.eventSource.addEvent(
                normalizedStart,
                normalizedEnd,
                isHalfDay,
                this.selectedMemberName,
                this.selectedMemberId,
                this.halfDayType.value
            );
    
        if (promise) {
            promise.then(() => this.props.calendarApi.refetchEvents());
        }
    
        this.props.onDismiss();
    };
    
    
    
    
    
    
    
    
}
