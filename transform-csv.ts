import { ap, bufIO, csv, inflect, model as m, poly } from "./deps.ts";
import * as td from "./typescript-decls.ts";

export interface Source {
  readonly csvSource: string;
  readonly moduleName?: inflect.InflectableValue;
  readonly interfIdentifier?: inflect.InflectableValue;
}

export class TransformCsvContentToTypeScript {
  readonly ph: ap.PersistenceHandler;
  readonly code: poly.TypeScriptCodeDeclaration;

  constructor(ph?: ap.PersistenceHandler) {
    this.ph = ph || new ap.ConsolePersistenceHandler();
    this.code = new poly.TypeScriptCodeDeclaration(this.ph);
  }

  async transformSourcesWithHeaders(sources: Source[]): Promise<void> {
    for (const source of sources) {
      const module = new poly.TypeScriptModuleDeclaration(
        this.code,
        source.moduleName || inflect.guessCaseValue(source.csvSource),
      );
      this.code.declareModule(module);
      const [model, intrfDecl] = await this.transformSingleSource(
        source,
        module,
      );
      module.declareInterface(intrfDecl);
    }
    this.emit(this.code);
  }

  async transformSourceWithHeaders(source: Source): Promise<void> {
    this.transformSourcesWithHeaders([source]);
  }

  protected createCodeContainer(): poly.TypeScriptCodeDeclaration {
    const ph = new ap.ConsolePersistenceHandler();
    return new poly.TypeScriptCodeDeclaration(ph);
  }

  protected emit(code: poly.PolyglotCodeDecl): void {
    code.emit(
      {
        isContext: true,
        execEnvs: {
          isExecutionEnvironments: true,
          environmentsName: inflect.guessCaseValue("CLI"),
        },
      },
      poly.consolePolyglotErrorHandler,
    );
  }

  protected async transformSingleSource(
    source: Source,
    module: poly.TypeScriptModuleDeclaration,
  ): Promise<[m.ContentModel, poly.TypeScriptInterfaceDeclaration]> {
    const interfIdentifier = source.interfIdentifier ||
      inflect.guessCaseValue(source.csvSource);
    const intrf = new poly.TypeScriptInterfaceDeclaration(
      module,
      source.interfIdentifier ||
        inflect.guessCaseValue(source.csvSource),
    );
    const model = await this.consumeSingleSource(source, intrf);
    td.createTypeScriptInterfaceDecl(model!, intrf);
    return [model, intrf];
  }

  protected async consumeSingleSource(
    source: Source,
    intrf: poly.TypeScriptInterfaceDeclaration,
  ): Promise<m.ContentModel> {
    const f = await Deno.open(source.csvSource);
    const matrix = await csv.readMatrix(new bufIO.BufReader(f));
    f.close();

    const colIndexByName: { [key: string]: number } = {};
    let headerRow: string[];
    let contentIndex = 0;
    let model = undefined;
    for (const row of matrix) {
      if (contentIndex == 0) {
        headerRow = row;
        row.map((col, index) => colIndexByName[col] = index);
        contentIndex++;
        continue;
      }

      const values: m.ContentValuesSupplier = {
        contentIndex: contentIndex,
        valueNames: headerRow!,
        valueByName: (name: string): any => {
          const index = colIndexByName[name];
          return row[index];
        },
      };

      if (contentIndex == 1) {
        const tdg = new m.TypicalModelGuesser({});
        tdg.guessDefnFromContent(values);
        model = tdg.model;
      }

      const content: { [name: string]: any } = {};
      m.typedContentTransformer(
        model!,
        values,
        {
          contentIndex: contentIndex - 1,
          assign: (
            name: string,
            value: any,
            transform: (name: string) => string,
          ): void => {
            const valueName = transform ? transform(name) : name;
            content[valueName] = value;
          },
        },
        m.consoleErrorHandler,
      );
      intrf.declareContent(content);
      contentIndex++;
    }
    return model!;
  }
}