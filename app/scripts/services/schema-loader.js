'use strict';

/**
 * @ngdoc function
 * @name groongaAdminApp.service:schemaLoader
 * @description
 * # schemaLoader
 * Groonga database schema loader.
 */
angular.module('groongaAdminApp')
  .factory('schemaLoader', [
    '$q', '$http', '$timeout',
    function ($q, $http, $timeout) {
      var fetching = false;
      var waitingDeferes = [];
      var fetched = false;
      var schema;
      var client = new GroongaClient($http);

      function createSchema() {
        var newSchema = {};
        fillTypes(newSchema);
        return newSchema;
      }

      function fillTypes(schema) {
        var builtinTypes = [
          {
            name: 'Bool'
          },
          {
            name: 'Int8'
          },
          {
            name: 'UInt8'
          },
          {
            name: 'Int16'
          },
          {
            name: 'UInt16'
          },
          {
            name: 'Int32'
          },
          {
            name: 'UInt32'
          },
          {
            name: 'Int64'
          },
          {
            name: 'UInt64'
          },
          {
            name: 'Float'
          },
          {
            name: 'Time'
          },
          {
            name: 'ShortText'
          },
          {
            name: 'Text'
          },
          {
            name: 'LongText'
          },
          {
            name: 'TokyoGeoPoint'
          },
          {
            name: 'WGS84GeoPoint'
          }
        ];
        schema.types = {};
        angular.forEach(builtinTypes, function(type) {
          schema.types[type.name] = type;
        });
      }

      function isTextType(typeName) {
        switch (typeName) {
        case 'ShortText':
        case 'Text':
        case 'LongText':
          return true;
        default:
          return false;
        }
      }

      function isReferenceType(schema, typeName) {
        return typeName in schema.tables;
      }

      function resolveTable(table) {
        table.keyType = {
          name: table.domain,
          isTextType: isTextType(table.domain)
        };
      }

      function resolveTables(schema) {
        angular.forEach(schema.tables, function(table) {
          resolveTable(table);
        });
      }

      function resolveColumn(schema, column) {
        column.valueType = {
          name: column.range,
          isTextType: isTextType(column.range),
          isReferenceType: isReferenceType(schema, column.range)
        };
      }

      function resolveColumns(schema) {
        angular.forEach(schema.tables, function(table) {
          angular.forEach(table.columns, function(column) {
            resolveColumn(schema, column);
          });
        });
      }

      function resolveIndex(schema, column) {
        var table = schema.tables[column.range];
        column.sources.forEach(function(source) {
          var columnName;
          if (source.indexOf('.') === -1) {
            columnName = '_key';
          } else {
            columnName = source.split('.')[1];
          }
          var targetColumn = table.columns[columnName];
          targetColumn.indexes.push(column);
        });
      }

      function resolveIndexes(schema) {
        angular.forEach(schema.tables, function(table) {
          angular.forEach(table.columns, function(column) {
            if (column.isIndex) {
              resolveIndex(schema, column);
            }
          });
        });
      }

      function addColumn(table, column) {
        column.table = table;
        column.indexes = [];
        table.columns[column.name] = column;
      }

      function fetchColumns(table) {
        table.columns = {};

        return client.execute('column_list', {table: table.name})
          .success(function(response) {
            var columns = response.columns();

            var rawIDColumn = [
              table.id,                   // id
              '_id',                      // name
              table.path,                 // path
              'fix',                      // type
              'COLUMN_SCALAR|PERSISTENT', // flags
              table.name,                 // domain
              'UInt32',                   // range
              []                          // source
            ];
            columns.unshift(response.parseRawColumn(rawIDColumn));

            columns.forEach(function(column) {
              addColumn(table, column);
            });
          });
      }

      function fetchTables(schema) {
        schema.tables = {};
        return client.execute('table_list')
          .success(function(response) {
            response.tables().forEach(function(table) {
              schema.tables[table.name] = table;
            });
            resolveTables(schema);

            var fetchColumnsTasks = [];
            angular.forEach(schema.tables, function(table) {
              fetchColumnsTasks.push(fetchColumns(table));
            });

            return $q.all(fetchColumnsTasks)
              .then(function() {
                resolveColumns(schema);
                resolveIndexes(schema);
                fetched = true;
                fetching = false;
                waitingDeferes.forEach(function(defer) {
                  defer.resolve(schema);
                });
                waitingDeferes = [];
                return schema;
              });
          });
      }

      schema = createSchema();

      return function() {
        var defer;
        var loader;
        if (fetching) {
          defer = $q.defer();
          waitingDeferes.push(defer);
          loader = defer.promise;
        } else if (fetched) {
          defer = $q.defer();
          $timeout(function() {
            defer.resolve(schema);
          });
          loader = defer.promise;
        } else {
          fetching = true;
          loader = fetchTables(schema);
        }
        loader.reload = function() {
          fetching = false;
          fetched = false;
          schema = createSchema();
        };
        return loader;
      };
    }]);
