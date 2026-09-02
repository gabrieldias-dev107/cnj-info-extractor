import portfolio from "../server/handlers/portfolio.js";
import items from "../server/handlers/portfolio-items.js";
import members from "../server/handlers/portfolio-members.js";
import { despachar } from "../server/handlers/dispatch.js";

export default despachar({ portfolio, items, members });
