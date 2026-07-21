using System.Text.Json;
using StjJsonSerializer = System.Text.Json.JsonSerializer;
using Microsoft.AnalysisServices.Tabular;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static int Main(string[] args)
    {
        try
        {
            var options = CliOptions.Parse(args);
            var json = File.ReadAllText(options.InputPath);
            var spec = StjJsonSerializer.Deserialize<TomDatabaseSpec>(json, JsonOptions)
                ?? throw new InvalidOperationException("TOM model specification is empty.");

            var database = BuildDatabase(spec);
            if (Directory.Exists(options.OutputPath)) Directory.Delete(options.OutputPath, recursive: true);
            Directory.CreateDirectory(options.OutputPath);

            TmdlSerializer.SerializeDatabaseToFolder(database, options.OutputPath);

            if (options.Roundtrip)
            {
                var roundtrip = TmdlSerializer.DeserializeDatabaseFromFolder(options.OutputPath);
                ValidateRoundtrip(spec, roundtrip);
            }

            Console.WriteLine($"Microsoft TOM serialized {database.Model.Tables.Count} tables, {database.Model.Relationships.Count} relationships, and {database.Model.Tables.Sum(t => t.Measures.Count)} measures to TMDL.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.ToString());
            return 1;
        }
    }

    private static Database BuildDatabase(TomDatabaseSpec spec)
    {
        if (string.IsNullOrWhiteSpace(spec.Name)) throw new InvalidOperationException("Database name is required.");
        if (spec.CompatibilityLevel < 1200) throw new InvalidOperationException("TMDL requires compatibility level 1200 or higher.");

        var database = new Database
        {
            ID = string.IsNullOrWhiteSpace(spec.Id) ? spec.Name : spec.Id,
            Name = spec.Name,
            CompatibilityLevel = spec.CompatibilityLevel,
            Model = new Model
            {
                Name = string.IsNullOrWhiteSpace(spec.Model.Name) ? "Model" : spec.Model.Name,
                Culture = string.IsNullOrWhiteSpace(spec.Model.Culture) ? "en-US" : spec.Model.Culture,
                SourceQueryCulture = string.IsNullOrWhiteSpace(spec.Model.SourceQueryCulture) ? "en-US" : spec.Model.SourceQueryCulture,
                DefaultPowerBIDataSourceVersion = PowerBIDataSourceVersion.PowerBI_V3,
            },
        };

        AddAnnotations(database.Model.Annotations, spec.Model.Annotations);

        var tableByName = new Dictionary<string, Table>(StringComparer.OrdinalIgnoreCase);
        var columnByQualifiedName = new Dictionary<string, Column>(StringComparer.OrdinalIgnoreCase);
        var globalMeasureNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var globalMeasureExpressions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var tableSpec in spec.Model.Tables)
        {
            if (tableByName.ContainsKey(tableSpec.Name)) throw new InvalidOperationException($"Duplicate table '{tableSpec.Name}'.");
            var table = new Table
            {
                Name = Required(tableSpec.Name, "table name"),
                Description = tableSpec.Description,
                IsHidden = tableSpec.IsHidden,
                LineageTag = NormalizeGuid(tableSpec.LineageTag),
            };
            AddAnnotations(table.Annotations, tableSpec.Annotations);

            foreach (var columnSpec in tableSpec.Columns)
            {
                if (table.Columns.Any(column => string.Equals(column.Name, columnSpec.Name, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException($"Duplicate column '{tableSpec.Name}[{columnSpec.Name}]'.");
                Column column = columnSpec.Kind.Equals("calculated", StringComparison.OrdinalIgnoreCase)
                    ? new CalculatedColumn
                    {
                        Name = Required(columnSpec.Name, "calculated column name"),
                        Expression = Required(columnSpec.Expression, $"expression for {tableSpec.Name}[{columnSpec.Name}]"),
                        DataType = ParseDataType(columnSpec.DataType),
                    }
                    : new DataColumn
                    {
                        Name = Required(columnSpec.Name, "source column name"),
                        SourceColumn = Required(columnSpec.SourceColumn, $"sourceColumn for {tableSpec.Name}[{columnSpec.Name}]"),
                        DataType = ParseDataType(columnSpec.DataType),
                    };

                column.Description = columnSpec.Description;
                column.IsHidden = columnSpec.IsHidden;
                column.IsKey = columnSpec.IsKey;
                column.SummarizeBy = ParseAggregateFunction(columnSpec.SummarizeBy);
                column.FormatString = columnSpec.FormatString;
                column.DataCategory = columnSpec.DataCategory;
                column.LineageTag = NormalizeGuid(columnSpec.LineageTag);
                AddAnnotations(column.Annotations, columnSpec.Annotations);
                table.Columns.Add(column);
                columnByQualifiedName[Qualified(tableSpec.Name, columnSpec.Name)] = column;
            }

            foreach (var columnSpec in tableSpec.Columns.Where(c => !string.IsNullOrWhiteSpace(c.SortByColumn)))
            {
                var column = table.Columns.FirstOrDefault(item => string.Equals(item.Name, columnSpec.Name, StringComparison.OrdinalIgnoreCase));
                var sortBy = table.Columns.FirstOrDefault(item => string.Equals(item.Name, columnSpec.SortByColumn!, StringComparison.OrdinalIgnoreCase));
                if (column is null || sortBy is null) throw new InvalidOperationException($"Invalid sort-by reference in '{tableSpec.Name}[{columnSpec.Name}]'.");
                column.SortByColumn = sortBy;
            }

            foreach (var measureSpec in tableSpec.Measures)
            {
                var measureName = Required(measureSpec.Name, "measure name");
                var measureExpression = Required(measureSpec.Expression, $"expression for measure {measureSpec.Name}");
                if (!globalMeasureNames.Add(measureName)) throw new InvalidOperationException($"Duplicate model measure name '{measureName}'. Measure names must be unique across the semantic model.");
                if (table.Columns.Any(column => string.Equals(column.Name, measureName, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException($"Measure '{tableSpec.Name}[{measureName}]' conflicts with a column of the same name.");
                var expressionKey = string.Concat(measureExpression.Where(character => !char.IsWhiteSpace(character))).ToLowerInvariant();
                if (!globalMeasureExpressions.Add(expressionKey)) throw new InvalidOperationException($"Duplicate DAX measure expression detected for '{tableSpec.Name}[{measureName}]'.");
                if (string.IsNullOrWhiteSpace(measureSpec.DisplayFolder)) throw new InvalidOperationException($"Measure '{tableSpec.Name}[{measureName}]' must be assigned to a display folder.");
                var measure = new Measure
                {
                    Name = measureName,
                    Expression = measureExpression,
                    Description = measureSpec.Description,
                    FormatString = measureSpec.FormatString,
                    DisplayFolder = measureSpec.DisplayFolder,
                    IsHidden = measureSpec.IsHidden,
                    LineageTag = NormalizeGuid(measureSpec.LineageTag),
                };
                AddAnnotations(measure.Annotations, measureSpec.Annotations);
                table.Measures.Add(measure);
            }

            foreach (var hierarchySpec in tableSpec.Hierarchies)
            {
                var hierarchy = new Hierarchy
                {
                    Name = Required(hierarchySpec.Name, "hierarchy name"),
                    Description = hierarchySpec.Description,
                    LineageTag = NormalizeGuid(hierarchySpec.LineageTag),
                };
                foreach (var levelSpec in hierarchySpec.Levels.OrderBy(level => level.Ordinal))
                {
                    var levelColumn = table.Columns.FirstOrDefault(item => string.Equals(item.Name, levelSpec.Column, StringComparison.OrdinalIgnoreCase))
                        ?? throw new InvalidOperationException($"Hierarchy '{hierarchySpec.Name}' references missing column '{tableSpec.Name}[{levelSpec.Column}]'.");
                    hierarchy.Levels.Add(new Level
                    {
                        Name = Required(levelSpec.Name, "hierarchy level name"),
                        Column = levelColumn,
                        Ordinal = levelSpec.Ordinal,
                        LineageTag = NormalizeGuid(levelSpec.LineageTag),
                    });
                }
                table.Hierarchies.Add(hierarchy);
            }

            foreach (var partitionSpec in tableSpec.Partitions)
            {
                var partition = new Partition
                {
                    Name = Required(partitionSpec.Name, "partition name"),
                    Mode = ParseMode(partitionSpec.Mode),
                    Source = partitionSpec.SourceType.Equals("calculated", StringComparison.OrdinalIgnoreCase)
                        ? new CalculatedPartitionSource { Expression = Required(partitionSpec.Expression, $"calculated table expression for {tableSpec.Name}") }
                        : new MPartitionSource { Expression = Required(partitionSpec.Expression, $"M expression for {tableSpec.Name}") },
                };
                AddAnnotations(partition.Annotations, partitionSpec.Annotations);
                table.Partitions.Add(partition);
            }
            if (table.Partitions.Count == 0) throw new InvalidOperationException($"Table '{tableSpec.Name}' has no partition.");

            database.Model.Tables.Add(table);
            tableByName[tableSpec.Name] = table;
        }

        foreach (var expressionSpec in spec.Model.Expressions)
        {
            var expression = new NamedExpression
            {
                Name = Required(expressionSpec.Name, "named expression name"),
                Expression = Required(expressionSpec.Expression, $"named expression {expressionSpec.Name}"),
                Kind = ExpressionKind.M,
                Description = expressionSpec.Description,
            };
            AddAnnotations(expression.Annotations, expressionSpec.Annotations);
            database.Model.Expressions.Add(expression);
        }

        foreach (var relationshipSpec in spec.Model.Relationships)
        {
            if (!columnByQualifiedName.TryGetValue(Qualified(relationshipSpec.FromTable, relationshipSpec.FromColumn), out var fromColumn))
                throw new InvalidOperationException($"Relationship '{relationshipSpec.Name}' references missing from column '{relationshipSpec.FromTable}[{relationshipSpec.FromColumn}]'.");
            if (!columnByQualifiedName.TryGetValue(Qualified(relationshipSpec.ToTable, relationshipSpec.ToColumn), out var toColumn))
                throw new InvalidOperationException($"Relationship '{relationshipSpec.Name}' references missing to column '{relationshipSpec.ToTable}[{relationshipSpec.ToColumn}]'.");

            var relationship = new SingleColumnRelationship
            {
                Name = Required(relationshipSpec.Name, "relationship name"),
                FromColumn = fromColumn,
                ToColumn = toColumn,
                FromCardinality = ParseCardinality(relationshipSpec.FromCardinality),
                ToCardinality = ParseCardinality(relationshipSpec.ToCardinality),
                CrossFilteringBehavior = relationshipSpec.CrossFilteringBehavior.Equals("bothDirections", StringComparison.OrdinalIgnoreCase)
                    ? CrossFilteringBehavior.BothDirections
                    : CrossFilteringBehavior.OneDirection,
                IsActive = relationshipSpec.IsActive,
            };
            AddAnnotations(relationship.Annotations, relationshipSpec.Annotations);
            database.Model.Relationships.Add(relationship);
        }

        return database;
    }

    private static void ValidateRoundtrip(TomDatabaseSpec source, Database roundtrip)
    {
        if (roundtrip.Model.Tables.Count != source.Model.Tables.Count)
            throw new InvalidOperationException($"TMDL roundtrip table count mismatch: expected {source.Model.Tables.Count}, found {roundtrip.Model.Tables.Count}.");
        if (roundtrip.Model.Relationships.Count != source.Model.Relationships.Count)
            throw new InvalidOperationException($"TMDL roundtrip relationship count mismatch: expected {source.Model.Relationships.Count}, found {roundtrip.Model.Relationships.Count}.");
        foreach (var tableSpec in source.Model.Tables)
        {
            var table = roundtrip.Model.Tables.FirstOrDefault(item => string.Equals(item.Name, tableSpec.Name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"TMDL roundtrip lost table '{tableSpec.Name}'.");
            if (table.Columns.Count != tableSpec.Columns.Count)
                throw new InvalidOperationException($"TMDL roundtrip column count mismatch for '{tableSpec.Name}'.");
            if (table.Measures.Count != tableSpec.Measures.Count)
                throw new InvalidOperationException($"TMDL roundtrip measure count mismatch for '{tableSpec.Name}'.");
        }
    }

    private static string Qualified(string table, string column) => $"{table}\u001f{column}";
    private static string Required(string? value, string label) => !string.IsNullOrWhiteSpace(value) ? value : throw new InvalidOperationException($"Missing {label}.");
    private static string? NormalizeGuid(string? value) => Guid.TryParse(value, out var parsed) ? parsed.ToString() : null;

    private static DataType ParseDataType(string value) => value.ToLowerInvariant() switch
    {
        "int64" => DataType.Int64,
        "double" => DataType.Double,
        "decimal" => DataType.Decimal,
        "datetime" => DataType.DateTime,
        "boolean" => DataType.Boolean,
        _ => DataType.String,
    };

    private static AggregateFunction ParseAggregateFunction(string? value) => value?.ToLowerInvariant() switch
    {
        "sum" => AggregateFunction.Sum,
        "count" => AggregateFunction.Count,
        "min" => AggregateFunction.Min,
        "max" => AggregateFunction.Max,
        "average" => AggregateFunction.Average,
        "distinctcount" => AggregateFunction.DistinctCount,
        _ => AggregateFunction.None,
    };

    private static ModeType ParseMode(string value) => value.ToLowerInvariant() switch
    {
        "directquery" => ModeType.DirectQuery,
        "dual" => ModeType.Dual,
        _ => ModeType.Import,
    };

    private static RelationshipEndCardinality ParseCardinality(string value) => value.Equals("many", StringComparison.OrdinalIgnoreCase)
        ? RelationshipEndCardinality.Many
        : RelationshipEndCardinality.One;

    private static void AddAnnotations(ICollection<Annotation> target, IEnumerable<TomAnnotationSpec>? annotations)
    {
        if (annotations is null) return;
        foreach (var annotation in annotations.Where(a => !string.IsNullOrWhiteSpace(a.Name)))
        {
            target.Add(new Annotation { Name = annotation.Name, Value = annotation.Value ?? string.Empty });
        }
    }
}

internal sealed record CliOptions(string InputPath, string OutputPath, bool Roundtrip)
{
    public static CliOptions Parse(string[] args)
    {
        string? input = null;
        string? output = null;
        var roundtrip = false;
        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--input" when index + 1 < args.Length:
                    input = args[++index];
                    break;
                case "--output" when index + 1 < args.Length:
                    output = args[++index];
                    break;
                case "--roundtrip":
                    roundtrip = true;
                    break;
            }
        }
        if (string.IsNullOrWhiteSpace(input) || string.IsNullOrWhiteSpace(output))
            throw new ArgumentException("Usage: TomTmdlBridge --input <tom-model-spec.json> --output <definition-folder> [--roundtrip]");
        return new CliOptions(Path.GetFullPath(input), Path.GetFullPath(output), roundtrip);
    }
}

internal sealed class TomDatabaseSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int CompatibilityLevel { get; set; } = 1604;
    public TomModelSpec Model { get; set; } = new();
}

internal sealed class TomModelSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = "Model";
    public string Culture { get; set; } = "en-US";
    public string SourceQueryCulture { get; set; } = "en-US";
    public List<TomTableSpec> Tables { get; set; } = [];
    public List<TomRelationshipSpec> Relationships { get; set; } = [];
    public List<TomNamedExpressionSpec> Expressions { get; set; } = [];
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomTableSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsHidden { get; set; }
    public string? LineageTag { get; set; }
    public List<TomColumnSpec> Columns { get; set; } = [];
    public List<TomMeasureSpec> Measures { get; set; } = [];
    public List<TomHierarchySpec> Hierarchies { get; set; } = [];
    public List<TomPartitionSpec> Partitions { get; set; } = [];
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomColumnSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Kind { get; set; } = "data";
    public string DataType { get; set; } = "string";
    public string? SourceColumn { get; set; }
    public string? Expression { get; set; }
    public bool IsHidden { get; set; }
    public bool IsKey { get; set; }
    public string? SummarizeBy { get; set; }
    public string? FormatString { get; set; }
    public string? DataCategory { get; set; }
    public string? SortByColumn { get; set; }
    public string? Description { get; set; }
    public string? LineageTag { get; set; }
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomMeasureSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Expression { get; set; } = string.Empty;
    public string? FormatString { get; set; }
    public string? DisplayFolder { get; set; }
    public string? Description { get; set; }
    public bool IsHidden { get; set; }
    public string? LineageTag { get; set; }
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomHierarchySpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? LineageTag { get; set; }
    public List<TomHierarchyLevelSpec> Levels { get; set; } = [];
}

internal sealed class TomHierarchyLevelSpec
{
    public string Name { get; set; } = string.Empty;
    public string Column { get; set; } = string.Empty;
    public int Ordinal { get; set; }
    public string? LineageTag { get; set; }
}

internal sealed class TomPartitionSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Mode { get; set; } = "import";
    public string SourceType { get; set; } = "m";
    public string Expression { get; set; } = string.Empty;
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomRelationshipSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string FromTable { get; set; } = string.Empty;
    public string FromColumn { get; set; } = string.Empty;
    public string ToTable { get; set; } = string.Empty;
    public string ToColumn { get; set; } = string.Empty;
    public string FromCardinality { get; set; } = "many";
    public string ToCardinality { get; set; } = "one";
    public string CrossFilteringBehavior { get; set; } = "oneDirection";
    public bool IsActive { get; set; } = true;
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomNamedExpressionSpec
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Expression { get; set; } = string.Empty;
    public string? Description { get; set; }
    public List<TomAnnotationSpec> Annotations { get; set; } = [];
}

internal sealed class TomAnnotationSpec
{
    public string Name { get; set; } = string.Empty;
    public string? Value { get; set; }
}
