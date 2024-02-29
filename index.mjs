import osc from "osc"
import { input } from "@inquirer/prompts"

const config = {
  caspar: {},
  companion: {}
}

const currentState = {
  current: 0,
  total: 0,
  name: null,
  fps: 0
}

let resetTimeout = null

const casparOSCPort = await input({
  message: "OSC Port:",
  default: 5254,
})

const casparSourceChannel = await input({
  message: "CasparCG Server Source Channel:",
  default: 2,
})

const casparSourceLayer = await input({
  message: "CasparCG Server Source Layer:",
  default: 10,
})

const companionIP = await input({
  message: "Bitfocus Companion IP:",
  default: "0.0.0.0",
})

const companionOSCPort = await input({
  message: "Bitfocus Companion OSC Port:",
  default: 12321,
})

const companionVariable = await input({
  message: "Bitfocus Companion Custom Variable:",
  default: "caspar_clip_left"
})

config.caspar.ip = "0.0.0.0"
config.caspar.oscPort = parseInt(casparOSCPort)
config.caspar.channel = parseInt(casparSourceChannel)
config.caspar.layer = parseInt(casparSourceLayer)

config.companion.ip = companionIP
config.companion.oscPort = parseInt(companionOSCPort)
config.companion.variable = companionVariable

const oscClient = new osc.UDPPort({
  localAddress: config.caspar.ip,
  localPort: config.caspar.oscPort,
  remoteAddress: config.companion.ip,
  remotePort: config.companion.oscPort
})

const formatTimecode = (t) => `${(t.m).toString().padStart(2, "0")}:${(t.s).toString().padStart(2, "0")}.${(t.f).toString().padStart(3, "0")}`

const processState = (block) => {
  if (block.name === null) {
    return "Empty"
  }

  if (block.current === -1) {
    return null
  }

  if (block.fps === 0) {
    const calcTimings = (time) => {
      const seconds = Math.floor(time);
      const milliseconds = Math.floor((time - seconds) * 1000);
      const minutes = Math.floor(seconds / 60)

      return formatTimecode({ m: minutes % 60, s: seconds % 60, f: milliseconds })
    }

    return calcTimings(block.total - block.current)
  } else {
    const calcTimings = (time) => {
      const cs = Math.floor(time / block.fps)
      const cm = Math.floor(cs / 60)
      const cf = (time % block.fps);

      return formatTimecode({ m: cm % 60, s: cs % 60, f: cf })
    }

    return calcTimings(block.total - block.current)
  }
}

const emitState = () => {
  const toSend = processState(currentState)

  if (toSend === null) {
    return
  }

  oscClient.send({
    address: `/custom-variable/${config.companion.variable}/value`,
    args: [
      {
        type: "s",
        value: toSend
      }
    ]
  }, config.companion.ip, config.companion.oscPort)
}

const clearState = () => {
  if (currentState.paused) { return }

  currentState.current = 0
  currentState.total = 0
  currentState.name = null
  currentState.fps = 0

  emitState()
}

oscClient.on("open", function() {
  console.log("Listening for OSC over UDP: CasparCG Server")
  console.log(`Host: ${config.caspar.ip}, Port: ${config.caspar.oscPort}`)
  console.log(" ")
})

const onOscMessage = function(message) {
  // console.log(message)
  if (message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/paused`) {
    currentState.paused = message.args[0]

    if (currentState.paused) {
      if (resetTimeout != null) {
        clearTimeout(resetTimeout)
      }

      resetTimeout = setTimeout(clearState, 150)
    }
  } else if (message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/file/frame` || message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/frame`) {
    currentState.current = message.args[0].low
    currentState.total = message.args[1].low
    
    emitState()
  } else if(message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/foreground/file/time`) {
    currentState.current = message.args[0]
    currentState.total = message.args[1]
    currentState.fps = 0

    emitState()
  } else if (message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/file/fps`) {
    currentState.fps = message.args[0]

    emitState()
  } else if (message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/file/path` || message.address === `/channel/${config.caspar.channel}/stage/layer/${config.caspar.layer}/foreground/file/name`) {
    if (resetTimeout != null) {
      clearTimeout(resetTimeout)
    }

    resetTimeout = setTimeout(clearState, 150)

    currentState.name = message.args[0].slice(0, -4).split("/").at(-1)
    emitState()
  }
}

oscClient.on("message", onOscMessage)

oscClient.open()

oscClient.on("error", function(error) {
  console.log("CasparCG Server error:")
  console.log(JSON.stringify(error))
  console.log(" ")
})

const stdin = process.openStdin()

const exit = () => {
  oscClient.off("message", onOscMessage)

  setTimeout(clearState, 200)
  setTimeout(process.exit, 400)
}

process.on("SIGINT", function() {
  console.log("Process exit event: Caught interrupt signal")
  exit()
})

process.on("SIGQUIT", function() {
  console.log("Process exit event: Quit")
  exit()
})

process.on("SIGTERM", function() {
  console.log("Process exit event: Killed")
  exit()
})

stdin.on("beforeExit", () => {
  exit()
})

stdin.on("exit", (code) => {
  exit()
  oscClient.close()
  console.log("Process exit event with code: ", code)
})

stdin.resume()