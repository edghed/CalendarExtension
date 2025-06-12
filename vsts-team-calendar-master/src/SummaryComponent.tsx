import React = require("react");

import { Link } from "azure-devops-ui/Link";
import { IListItemDetails, ListItem, ScrollableList } from "azure-devops-ui/List";
import { Observer } from "azure-devops-ui/Observer";

import { IEventCategory } from "./Contracts";
import { FreeFormEventsSource } from "./FreeFormEventSource";
import { VSOCapacityEventSource } from "./VSOCapacityEventSource";
import { RemoteEventSource } from "./RemoteEventSource";

interface ISummaryComponentProps {
    /**
     * Object that stores all event data
     */
    capacityEventSource: VSOCapacityEventSource;

    /**
     * Object that stores all event data
     */
    freeFormEventSource: FreeFormEventsSource;
    remoteEventSource: RemoteEventSource;
}

export class SummaryComponent extends React.Component<ISummaryComponentProps> {
    constructor(props: ISummaryComponentProps) {
        super(props);
    }

    public render(): JSX.Element {
        return (
            <div className="summary-area">
                <Observer url={this.props.capacityEventSource.getIterationUrl()}>
                    {(props: { url: string }) => {
                        return (
                            <Link className="category-heading" href={props.url} key={props.url} target="_blank">
                                Iterations
                            </Link>
                        );
                    }}
                </Observer>
                <Observer iterationSummaryData={this.props.capacityEventSource.getIterationSummaryData()}>
                    {(props: { iterationSummaryData: IEventCategory[] }) => {
                        return props.iterationSummaryData.length === 0 ? (
                            <div className="empty">(None)</div>
                        ) : (
                            <ScrollableList
                                itemProvider={this.props.capacityEventSource.getIterationSummaryData()}
                                renderRow={this.renderRow}
                                width="100%"
                            />
                        );
                    }}
                </Observer>
    
                <Observer url={this.props.capacityEventSource.getCapacityUrl()}>
                    {(props: { url: string }) => {
                        return (
                            <Link className="category-heading" href={props.url} key={props.url} target="_blank">
                                Days off
                            </Link>
                        );
                    }}
                </Observer>
                <Observer capacitySummaryData={this.props.capacityEventSource.getCapacitySummaryData()}>
                    {(props: { capacitySummaryData: IEventCategory[] }) => {
                        return props.capacitySummaryData.length === 0 ? (
                            <div className="empty">(None)</div>
                        ) : (
                            <ScrollableList
                                itemProvider={this.props.capacityEventSource.getCapacitySummaryData()}
                                renderRow={this.renderRow}
                                width="100%"
                            />
                        );
                    }}
                </Observer>
    
                <a className="category-heading">Training</a>
                <Observer eventSummaryData={this.props.freeFormEventSource.getSummaryData()}>
                    {(props: { eventSummaryData: IEventCategory[] }) => {
                        return props.eventSummaryData.length === 0 ? (
                            <div className="empty">(None)</div>
                        ) : (
                            <ScrollableList
                                itemProvider={this.props.freeFormEventSource.getSummaryData()}
                                renderRow={this.renderRow}
                                width="100%"
                            />
                        );
                    }}
                </Observer>
    
                {/* ✅ Nouvelle section Remote */}
                <a className="category-heading">Remote</a>
                <Observer remoteSummaryData={this.props.remoteEventSource.getSummaryData()}>
                    {(props: { remoteSummaryData: IEventCategory[] }) => {
                        return props.remoteSummaryData.length === 0 ? (
                            <div className="empty">(None)</div>
                        ) : (
                            <ScrollableList
                                itemProvider={this.props.remoteEventSource.getSummaryData()}
                                renderRow={this.renderRow}
                                width="100%"
                            />
                        );
                    }}
                </Observer>
                <button className="bolt-button bolt-button-primary margin-top-16" onClick={this.handleUpdateCapacities}>
    Ajuster les capacités
</button>

            </div>
        );
    }
    

    private renderRow = (index: number, item: IEventCategory, details: IListItemDetails<IEventCategory>, key?: string): JSX.Element => {
        return (
            <ListItem key={key || "list-item" + index} index={index} details={details}>
                
                <div className="catagory-summary-row flex-row h-scroll-hidden">
                {item.imageUrl ? (
                    <img alt="" className="category-icon" src={item.imageUrl} />
                ) : (
                    <div className="category-color" style={{ backgroundColor: item.color || "#cccccc" }} />
                )}

                    <div className="flex-column h-scroll-hidden catagory-data">
                        <div className="category-titletext">{item.title}</div>
                        <div className="category-subtitle">
                        {item.subTitle ?? `${item.eventCount} day${item.eventCount !== 1 ? "s" : ""} off`}
                        </div>

                    </div>
                </div>
            </ListItem>
        );
    };
    private handleUpdateCapacities = async () => {
        const source = this.props.capacityEventSource;
    
        try {
            //  Étape 1 : Récupération des sprints
            console.log(" Fetching iterations...");
            const iterations = await source.fetchIterations();
    
            //  Étape 2 : Identification de l'itération actuelle
            const now = new Date();
            const current = iterations.find(it => {
                const start = new Date(it.attributes?.startDate ?? "");
                const end = new Date(it.attributes?.finishDate ?? "");
                console.log(`[DEBUG] Sprint check: ${it.name} | ${start.toISOString()} → ${end.toISOString()} | now=${now.toISOString()}`);
                return start <= now && now <= end;
            });
    
            if (!current) {
                alert(" Impossible de trouver l'itération actuelle.");
                return;
            }
    
            console.log(` Itération détectée : ${current.name} (ID=${current.id})`);
    
            //  Étape 3 : Préparation des données capacité
            await source.prepareCapacityAdjustments(current.id);

            //  Étape 4 : Mise à jour des capacités
            await source.updateCapacitiesBasedOnTraining(current.id);
    
            alert(" Capacités mises à jour avec succès !");
        } catch (err) {
            console.error(" Erreur mise à jour des capacités :", err);
            alert(" Une erreur est survenue lors de la mise à jour des capacités.\n" + (err as any)?.message);
        }
    };
    
}
