import { ModelType } from "../../../DigitalTwin/pnp/src/deviceModel/deviceModelManager";
import { OperationFailedError } from "../OperationFailedErrors/OperationFailedError";

export class PnPModelTypeInvalidError extends OperationFailedError {
	constructor(operation: string, type: ModelType) {
		super(operation, `Invalid model type: ${type}`, "");
		this.name = "PnPModelTypeInvalidError";
	}
}
