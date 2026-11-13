// Module boundary for the MongoDB variant: it keeps these files out of an enclosing module's ./... (basekit-go
// vets its own tree). mongo-setup.sh never copies this file: the project's go.mod is derived from the starter.
module app

go 1.27
