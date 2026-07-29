export type Space = {
  id: string
  title: string
  memberCount: number
  adminTgUserId: number
}

export type SpaceSettings = {
  allowNewMembers: boolean
}

export type Member = {
  id: string
  name: string
}

export type Slot = {
  id: string
  startsAt: string
  addedBy: string
  createdAt: string
  votes: string[]
}

export type PlaceOption = {
  id: string
  name: string
  mapsUrl: string | null
  addedBy: string
  createdAt: string
  votes: string[]
}

export type Rsvp = {
  memberId: string | null
  guestName: string | null
  invitedBy: string | null
  status: 'going' | 'declined' | 'waitlisted'
}

export type Category =
  | 'food'
  | 'drinks'
  | 'games'
  | 'culture'
  | 'sport'
  | 'nature'
  | 'home'
  | 'party'
  | 'trip'
  | 'other'

export type Recurrence = 'weekly' | 'monthly'

export type EventItem = {
  id: string
  spaceId: string
  title: string
  category: Category
  createdBy: string
  maxPeople: number | null
  costPerPerson: number | null
  cancelledAt: string | null
  confirmedAt: string | null
  confirmedSlotId: string | null
  confirmedPlaceId: string | null
  recurrence: Recurrence | null
  slots: Slot[]
  placeOptions: PlaceOption[]
  rsvps: Rsvp[]
}

export type PlaceSuggestion = {
  id: string
  name: string
  mapsUrl: string | null
  address: string | null
  photoUrl: string | null
  source: 'own' // майбутнє: 'nearby' | 'ad'
}

export type ReminderMinutes = 60 | 180 | 1440

export type UserSettings = {
  notifyNewEvents: boolean
  notifyPromotions: boolean
  reminderMinutes: ReminderMinutes | null
}

export const CATEGORIES: Record<Category, { emoji: string; label: string }> = {
  culture: { emoji: '🎭', label: 'Культура' },
  sport: { emoji: '⚽', label: 'Спорт' },
  games: { emoji: '🎲', label: 'Ігри' },
  nature: { emoji: '🌲', label: 'Природа' },
  home: { emoji: '🏠', label: 'Вдома' },
  food: { emoji: '🍜', label: 'Їжа' },
  trip: { emoji: '🚗', label: 'Поїздка' },
  drinks: { emoji: '🍻', label: 'Дрінки' },
  other: { emoji: '✨', label: 'Інше' },
  party: { emoji: '🎉', label: 'Свято' },
}
