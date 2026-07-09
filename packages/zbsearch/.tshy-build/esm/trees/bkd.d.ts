import type { Nullable, GenericSorting } from '../types.js';
import type { InternalDocumentID } from '../components/internal-document-id-store.js';
export interface Point {
    lon: number;
    lat: number;
}
export interface GeoSearchResult {
    point: Point;
    docIDs: InternalDocumentID[];
}
export type SortGeoPoints = Nullable<GenericSorting>;
declare class BKDNode {
    point: Point;
    docIDs: Set<InternalDocumentID>;
    left: Nullable<BKDNode>;
    right: Nullable<BKDNode>;
    parent: Nullable<BKDNode>;
    constructor(point: Point, docIDs?: InternalDocumentID[]);
    toJSON(): any;
    static fromJSON(json: any, parent?: Nullable<BKDNode>): BKDNode;
}
export declare class BKDTree {
    root: Nullable<BKDNode>;
    nodeMap: Map<string, BKDNode>;
    constructor();
    private getPointKey;
    insert(point: Point, docIDs: InternalDocumentID[]): void;
    contains(point: Point): boolean;
    getDocIDsByCoordinates(point: Point): Nullable<InternalDocumentID[]>;
    removeDocByID(point: Point, docID: InternalDocumentID): void;
    private deleteNode;
    searchByRadius(center: Point, radius: number, inclusive?: boolean, sort?: SortGeoPoints, highPrecision?: boolean): GeoSearchResult[];
    searchByPolygon(polygon: Point[], inclusive?: boolean, sort?: SortGeoPoints, highPrecision?: boolean): GeoSearchResult[];
    toJSON(): any;
    static fromJSON(json: any): BKDTree;
    private buildNodeMap;
    static calculatePolygonCentroid(polygon: Point[]): Point;
    static isPointInPolygon(polygon: Point[], point: Point): boolean;
    static haversineDistance(coord1: Point, coord2: Point): number;
    static vincentyDistance(coord1: Point, coord2: Point): number;
}
export {};
