import { generatePbipZip } from "./pbip-generator";
import * as fs from 'fs';

async function test() {
  const analysis: any = {
    mQueries: {
      "Sales": "let Source = 1 in Source",
      "Customers": "let Source = 2 in Source",
      "Products": "let Source = 3 in Source"
    },
    semanticModel: {
      tables: [
        { name: "Sales" }
      ]
    },
    columnTypes: {},
    daxMeasures: []
  };

  const blob = await generatePbipZip(analysis, "Test");
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync("test.zip", buffer);
  console.log("Wrote test.zip");
}
test();
