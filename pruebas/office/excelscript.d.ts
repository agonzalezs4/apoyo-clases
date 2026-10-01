// Declaración mínima de la API de Office Scripts que usa Recolector.ts (solo para comprobar tipos fuera de Excel)
declare namespace ExcelScript {
  type CellValue = string | number | boolean;
  interface Workbook {
    getWorksheet(name: string): Worksheet | undefined;
    addWorksheet(name?: string): Worksheet;
    getTable(name: string): Table | undefined;
    addTable(address: Range | string, hasHeaders: boolean): Table;
  }
  interface Worksheet {
    getRange(address?: string): Range;
    getUsedRange(valuesOnly?: boolean): Range | undefined;
    getName(): string;
  }
  interface Range {
    getValues(): CellValue[][];
    setValues(values: CellValue[][]): void;
    getResizedRange(deltaRows: number, deltaColumns: number): Range;
    setNumberFormat(format: string): void;
    getRowCount(): number;
  }
  interface Table {
    getRangeBetweenHeaderAndTotal(): Range;
    addRows(index?: number, values?: CellValue[][]): void;
    deleteRowsAt(index: number, count?: number): void;
    setName(name: string): void;
    getName(): string;
    getRowCount(): number;
  }
}
