import { AnyZBSearch, TypedDocument, Optional } from '../types.js';
export declare function getByID<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(db: T, id: string): Optional<ResultDocument>;
export declare function count<T extends AnyZBSearch>(db: T): number;
