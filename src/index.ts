import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI();

async function basicExample() {
  try {
    const response = await openai.models.list();
    console.log("API Request Successful!");
    response.data.forEach((model) => {
      console.log(`- ${model.id}`);
    });
  } catch (error) {
    console.error(`API Request Failed: ${error}`);
  }
}

basicExample();