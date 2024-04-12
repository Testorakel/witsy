
import { Command } from '../index.d'
import { Configuration } from '../config.d'
import { App, BrowserWindow, clipboard, Notification } from 'electron'
import { settingsFilePath, loadSettings } from '../config'
import OpenAI from '../services/openai'
import Ollama from '../services/ollama'
import Message from '../models/message'
import Automator from './automator'
import * as window from '../window'

const buildLLm = (config: Configuration, engine:string) => {

  // build llm
  if (engine === 'ollama') {
    return new Ollama(config)
  } else if (config.engines.openai.apiKey) {
    return new OpenAI(config)
  } else {
    return null
  }

}

const promptLlm = (config: Configuration, engine: string, model: string, prompt: string) => {

  // get llm
  const llm = buildLLm(config, engine)

  // build messages
  const messages: Message[]  = [
    new Message('user', prompt)
  ]

  // now get it
  return llm.complete(messages, { model: model })

}

const finalizeCommand = async (command: Command, text: string, engine: string, model: string) => {
  
  // we need an automator
  const automator = new Automator();

  if (command.action === 'chat_window') {

    return window.openChatWindow({
      prompt: text,
      engine: engine || command.engine,
      model: model || command.model
    })
  
  } else if (command.action === 'paste_below') {

    await automator.moveCaretBelow()
    await automator.pasteText(text)

  } else if (command.action === 'paste_in_place') {

    await automator.pasteText(text)

  } else if (command.action === 'clipboard_copy') {

    await clipboard.writeText(text)

  }

}

export const prepareCommand = async () => {

  // hide active windows
  window.hideActiveWindows();
  await window.releaseFocus();

  // grab text
  const automator = new Automator();
  const text = await automator.getSelectedText();
  //console.log('Text grabbed', text);

  // notify if no text
  if (text == null || text.trim() === '') {
    try {
      new Notification({
        title: 'Witty AI',
        body: 'Please highlight the text you want to analyze'
      }).show()
      console.log('No text selected');
      window.restoreWindows();
    } catch (error) {
      console.error('Error showing notification', error);
    }
    return;
  }

  // log
  console.debug('Text grabbed:', `${text.slice(0, 50)}...`);

  // go on
  await window.openCommandPalette(text)

}

export const runCommand = async (app: App, text: string, command: Command) => {

  //
  const result = {
    text: text,
    prompt: null as string | null,
    response: null as string | null,
    chatWindow: null as BrowserWindow | null,
  };


  try {

    // config
    const config = loadSettings(settingsFilePath(app));

    // extract what we need
    const template = command.template;
    const action = command.action;
    const engine = command.engine || config.llm.engine;
    const model = command.model || config.getActiveModel();
    // const temperature = command.temperature;

    // build prompt
    result.prompt = template.replace('{input}', result.text);

    // new window is different
    if (action === 'chat_window') {
      
      result.chatWindow = await finalizeCommand(command, result.prompt, engine, model);

    } else {
      
      // open waiting panel
      window.openWaitingPanel();

      // now prompt llm
      console.debug(`Prompting with ${result.prompt.slice(0, 50)}...`);
      const response = await promptLlm(config, engine, model, result.prompt);
      result.response = response.content;

      // done
      await window.closeWaitingPanel();
      await window.releaseFocus();

      // now paste
      console.debug(`Processing LLM output: ${result.response.slice(0, 50)}...`);
      await finalizeCommand(command, result.response, engine, model);

    }

  } catch (error) {
    console.error('Error while testing', error);
  }

  // done waiting
  console.log('Destroying waiting panel')
  await window.closeWaitingPanel(true);
  window.releaseFocus();

  // done
  return result;

}
