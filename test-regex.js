const str = "LOAD * FROM [lib://DataFiles/Sales.csv];";
const match = str.match(/LOAD\s+([\s\S]*?)(?:\s+(FROM|RESIDENT)\s+([\s\S]+))?$/i);
console.log(match);
