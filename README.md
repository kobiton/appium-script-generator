# appium-script-generator
The Appium Script Generator will launch a gRPC server, which generates an Appium script whenever it receives a GenerateScript request. After generating the script, it sends the GenerateScript response back to the client.

### Requirements

- Node.js v14.16.1
- Yarn 1.22.4

### Commands

- `yarn install`: Install all dependent modules
- `yarn start`: Start gRPC server
- `yarn test`: Run unit tests
- `yarn lint`: Check coding standard

### Some explaination about this project structure

* `scripts`: Contains bash scripts for building and running this project on Kobiton System only.
* `src`: Contains the source code for the project.
  * `handlers`: Contains the request handlers for the gRPC server.
  * `services`: Contains the gRPC service implementations.
  * `templates`: Contains code templates used to generate the final project output. These templates are used by the gRPC server to generate Appium scripts in response to client requests.
