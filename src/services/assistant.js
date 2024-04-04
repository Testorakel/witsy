
import { ipcRenderer } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import Chat from '../models/chat'
import Message from '../models/message'
import OpenAI from '../services/openai'
import { store } from '../services/store'

export default class {

  constructor(config) {
    this.config = config
    this.llm = null
    this.chat = null
    this.newChat()
  }

  newChat(title) {

    // select last chat
    if (store.chats.length > 0) {
      this.chat = store.chats[store.chats.length - 1]
    }

    // now check
    if (this.chat === null || this.chat.messages.length > 1) { 
      this.chat = new Chat(title)
      this.chat.addMessage(new Message('system', this.config.instructions.default))
      store.chats.push(this.chat)
      store.save()
    }
  }

  setChat(chat) {
    this.chat = chat
  }

  initLlm() {
    this.llm = new OpenAI(this.config)
  }

  hasLlm() {
    return this.llm !== null
  }

  async route(prompt) {
    // build messages
    let messages = [
      new Message('system', this.config.instructions.routing),
      new Message('user', prompt)
    ]

    // now get it
    let route = await this.llm.complete(messages, { model: 'gpt-3.5-turbo' })
    return route.content
  }

  async prompt(prompt, callback) {

    // check
    prompt = prompt.trim()
    if (prompt === '') {
      return
    }

    // add message
    let message = new Message('user', prompt)
    this.chat.addMessage(message)
    store.cleanEmptyChats()

    // add assistant message
    this.chat.addMessage(new Message('assistant'))
    this.chat.lastMessage().setText(null)
    if (callback) callback()

    // route
    let route = await this.route(prompt)
    if (route === 'IMAGE') {
      await this.generateImage(prompt, callback)
    } else {
      await this.generateText(prompt, callback)
    }

    // check if we need to update title
    if (this.chat.messages.filter((msg) => msg.role === 'assistant').length === 1) {
      this.chat.setTitle(await this.getTitle())
    }
  
    // save
    store.save()

  }

  async generateText(prompt, callback) {
    let stream = await this.llm.stream(this._getRelevantChatMessages())
    for await (let chunk of stream) {
      let text = chunk.choices[0]?.delta?.content || ''
      this.chat.lastMessage().appendText(text)
      if (callback) callback(text)
    }
  }

  async generateImage(prompt, callback) {

    // generate 
    let response = await this.llm.image(prompt)

    // we need to download it locally
    let filename = `${uuidv4()}.png`
    filename = ipcRenderer.sendSync('download', {
      url: response.url,
      properties: {
        filename: filename,
        directory: 'userData',
        subdir: 'images',
        prompt: false
      }
    })

    // save
    filename = `file://${filename}`
    this.chat.lastMessage().setImage(filename)
    if (callback) callback(filename)
  }

  async getTitle() {

    // build messages
    let messages = [
      new Message('system', this.config.instructions.titling),
      this.chat.messages[1],
      this.chat.messages[2]
    ]

    // now get it
    let response = await this.llm.complete(messages)
    let title = response.content

    // now clean up
    if (title.startsWith('Title:')) {
      title = title.substring(6)
    }
    return title.trim().replace(/^"|"$/g, '').trim()
  }

  _getRelevantChatMessages() {
    const relevantMessagesCount = 5
    let chatMessages = this.chat.messages.filter((msg) => msg.role !== 'system')
    let messages = [this.chat.messages[0], ...chatMessages.slice(-relevantMessagesCount-1, -1)]
    return messages
  }

}