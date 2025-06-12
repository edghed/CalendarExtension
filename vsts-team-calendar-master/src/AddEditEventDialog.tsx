import React = require("react");

import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { CustomDialog } from "azure-devops-ui/Dialog";
import { EditableDropdown } from "azure-devops-ui/EditableDropdown";
import { TitleSize } from "azure-devops-ui/Header";
import { IListSelection, ListSelection } from "azure-devops-ui/List";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { Observer } from "azure-devops-ui/Observer";
import { PanelHeader, PanelFooter, PanelContent } from "azure-devops-ui/Panel";
import { TextField } from "azure-devops-ui/TextField";

import { Calendar, EventApi } from "@fullcalendar/core";

import { FreeFormEventsSource } from "./FreeFormEventSource";
import { MessageDialog } from "./MessageDialog";
import { toDate, formatDate } from "./TimeLib";

interface IAddEditEventDialogProps {
    dialogTitle?: string;
    calendarApi: Calendar;
    eventApi?: EventApi;
    end: Date;
    eventSource: FreeFormEventsSource;
    onDismiss: () => void;
    start: Date;
    teamMembers: { id: string; displayName: string }[];

}

export class AddEditEventDialog extends React.Component<IAddEditEventDialogProps> {
    startDate: Date;
    endDate: Date;
    isConfirmationDialogOpen: ObservableValue<boolean> = new ObservableValue(false);
    okButtonEnabled: ObservableValue<boolean> = new ObservableValue(false);
    title: ObservableValue<string> = new ObservableValue("");
    description: ObservableValue<string> = new ObservableValue("");
    category: string = "";
    isHalfDay: ObservableValue<boolean> = new ObservableValue(false);
    halfDayType: ObservableValue<"AM" | "PM" | undefined> = new ObservableValue(undefined);
    message: ObservableValue<string> = new ObservableValue("");
    catagorySelection: IListSelection = new ListSelection();
    selectedMemberId: string;
    selectedMemberName: string;
    teamMembers: IListBoxItem[] = [
        { id: "default-id", text: "Default User" }
    ];
    memberSelection: IListSelection = new ListSelection();

    constructor(props: IAddEditEventDialogProps) {
        super(props);
    
        // Injecter dynamiquement les vrais membres de l’équipe
        this.teamMembers = props.teamMembers.map(member => ({
            id: member.id,
            text: member.displayName
        }));
    
        // Valeurs par défaut si la liste est vide
        this.selectedMemberId = this.teamMembers[0]?.id ?? "default-id";
        this.selectedMemberName = this.teamMembers[0]?.text ?? "Default User";
        this.memberSelection.select(0);
    
        // Initialiser les dates
        if (this.props.eventApi) {
            this.startDate = this.props.eventApi.start!;
            if (this.props.eventApi.end) {
                this.endDate = new Date(this.props.eventApi.end);
                this.endDate.setDate(this.props.eventApi.end.getDate() - 1);
            } else {
                this.endDate = new Date(this.props.eventApi.start!);
            }
    
            this.title.value = this.props.eventApi.title;
            this.description.value = this.props.eventApi.extendedProps.description || "";
            this.category = this.props.eventApi.extendedProps.category || "";
            this.isHalfDay.value = this.props.eventApi.extendedProps.isHalfDay || false;
            this.halfDayType.value = this.props.eventApi.extendedProps.halfDay ?? undefined;
    
            this.catagorySelection.select(0);
        } else {
            this.startDate = props.start;
            this.endDate = props.end;
        }
    }
    

    public render(): JSX.Element {
        return (
            <>
                <CustomDialog onDismiss={this.props.onDismiss}>
                    <PanelHeader
                        onDismiss={this.props.onDismiss}
                        showCloseButton={false}
                       titleProps={{ size: TitleSize.Small, text: this.props.dialogTitle ?? (this.props.eventApi ? "Edit event" : "Add event") }}
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
                                <span>Title</span>
                                <TextField className="column-2" onChange={this.onInputTitle} value={this.title} />
                            </div>
                            <div className="input-row flex-row">
                                <span>Start Date</span>
                                <div className="bolt-textfield column-2">
                                    <input
                                        className="bolt-textfield-input input-date"
                                        defaultValue={formatDate(this.startDate, "YYYY-MM-DD")}
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
                                        defaultValue={formatDate(this.endDate, "YYYY-MM-DD")}
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
                                                this.validateSelections();
                                            }}
                                        />
                                    )}
                                </Observer>
                            </div>
                            <div className="input-row flex-row">
                                <span>Team Member</span>
                                <EditableDropdown
                                    className="column-2"
                                    items={this.teamMembers}
                                    selectedText={this.selectedMemberName}
                                    onValueChange={(val?: IListBoxItem) => {
                                        this.selectedMemberId = val?.id ?? this.selectedMemberId;
                                        this.selectedMemberName = val?.text ?? this.selectedMemberName;
                                    }}
                                />
                            </div>
                            <div className="input-row flex-row">
                                <span>Category</span>
                                <EditableDropdown
                                    allowFreeform={true}
                                    className="column-2"
                                    items={Array.from(this.props.eventSource.getCategories())}
                                    onValueChange={this.onCatagorySelectionChange}
                                    placeholder={this.category}
                                />
                            </div>
                            <div className="input-row flex-row">
                                <span>Description</span>
                                <TextField className="column-2" onChange={this.onInputDescription} multiline={true} value={this.description} />
                            </div>
                        </div>
                    </PanelContent>
                    <PanelFooter>
                        <div className="flex-grow flex-row">
                            {this.props.eventApi && <Button onClick={this.onDeleteClick} subtle={true} text="Delete event" />}
                            <ButtonGroup className="bolt-panel-footer-buttons flex-grow">
                                <Button onClick={this.props.onDismiss} text="Cancel" />
                                <Observer enabled={this.okButtonEnabled}>
                                    {(props: { enabled: boolean }) => (
                                        <Button disabled={!props.enabled} onClick={this.onOKClick} primary={true} text="Ok" />
                                    )}
                                </Observer>
                            </ButtonGroup>
                        </div>
                    </PanelFooter>
                </CustomDialog>
                <Observer isDialogOpen={this.isConfirmationDialogOpen}>
                    {(props: { isDialogOpen: boolean }) =>
                        props.isDialogOpen ? (
                            <MessageDialog
                                message="Are you sure you want to delete the event?"
                                onConfirm={this.onConfirmDelete}
                                onDismiss={this.onDismissDelete}
                                title="Delete event"
                            />
                        ) : null
                    }
                </Observer>
            </>
        );
    }

    private onCatagorySelectionChange = (value?: IListBoxItem<{}>): void => {
       
        this.validateSelections();
    };

    private onDeleteClick = async (): Promise<void> => {
        this.isConfirmationDialogOpen.value = true;
    };

    private onConfirmDelete = (): void => {
        const { eventApi, eventSource, calendarApi, onDismiss } = this.props;
        if (eventApi) {
            eventSource.deleteEvent(eventApi.extendedProps.id, eventApi.start!).then(() => {
                calendarApi.refetchEvents();
            });
        }
        this.isConfirmationDialogOpen.value = false;
        onDismiss();
    };

    private onDismissDelete = (): void => {
        this.isConfirmationDialogOpen.value = false;
    };

    private onInputDescription = (e: React.ChangeEvent, value: string): void => {
        this.description.value = value;
        this.validateSelections();
    };

    private onInputEndDate = (e: React.ChangeEvent<HTMLInputElement>): void => {
        this.endDate = toDate(e.target.value);
        this.validateSelections();
    };

    private onInputStartDate = (e: React.ChangeEvent<HTMLInputElement>): void => {
        this.startDate = toDate(e.target.value);
        this.validateSelections();
    };

    private onInputTitle = (e: React.ChangeEvent, value: string): void => {
        this.title.value = value;
        this.validateSelections();
    };

    private onOKClick = (): void => {
        const excludedEndDate = new Date(this.endDate);
        excludedEndDate.setDate(this.endDate.getDate() + 1);
        this.category = "Training";


        const { eventApi, eventSource, calendarApi, onDismiss } = this.props;
        const saveEvent = eventApi
            ? eventSource.updateEvent(
                  eventApi.extendedProps.id,
                  this.title.value,
                  this.startDate,
                  this.endDate,
              
                  this.description.value,
                  this.halfDayType.value
              )
            : eventSource.addEvent(
                  this.title.value,
                  this.startDate,
                  this.endDate,
              
                  this.description.value,
                  this.halfDayType.value,
                  this.selectedMemberId
              );
        saveEvent.then(() => {
            calendarApi.refetchEvents();
        });

        onDismiss();
    };

    private validateSelections = (): void => {
        const titleEmpty = this.title.value === "";
        const dateInvalid = this.startDate > this.endDate;
        this.okButtonEnabled.value = !titleEmpty && !dateInvalid;
        if (titleEmpty) {
            this.message.value = "Title can not be empty.";
        } else if (dateInvalid) {
            this.message.value = "Start date must be same or before the end date.";
        } else {
            this.message.value = "";
        }
    };
}
