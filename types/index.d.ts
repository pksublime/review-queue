export type ItemState = 'new' | 'drafted' | 'posted' | 'resolved' | 'dropped'

export type QueueItem = {
  id: string
  source: 'finding' | 'comment'
  file: string
  line?: number
  summary: string
  // The full text /next-comment shows Claude.
  detail: string
  url?: string
  state: ItemState
}

export type Pr = {
  key: string
  repo: string
  number: number
  url: string
  title: string
}

export type Queue = {
  pr?: Pr
  items: QueueItem[]
  current?: string
  checkedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'review-queue': { queue: Shaped<Queue>; notice: string }
  }
}
