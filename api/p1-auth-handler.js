import login from "../server/handlers/auth-login.js";
import callback from "../server/handlers/auth-callback.js";
import { despachar } from "../server/handlers/dispatch.js";

export default despachar({ login, callback });
