"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../db");
dotenv_1.default.config();
const dropEmailIndex = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.connectDB)();
        const db = mongoose_1.default.connection.db;
        if (!db) {
            throw new Error("❌ Database connection not initialized.");
        }
        const indexes = yield db.collection("guests").indexInformation();
        console.log("📌 Existing Indexes:", indexes);
        if (indexes.email_1) {
            yield db.collection("guests").dropIndex("email_1");
            console.log("✅ Dropped unique index on 'email'");
        }
        else {
            console.log("ℹ️ No 'email_1' index found");
        }
    }
    catch (error) {
        console.error("❌ Error dropping index:", error);
    }
    finally {
        yield mongoose_1.default.disconnect();
    }
});
dropEmailIndex();
