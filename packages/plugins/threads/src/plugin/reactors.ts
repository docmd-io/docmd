import type { Reaction, Reactor } from '../types.js';

/** Who is reacting: the identity key and the display name. */
export interface ReactionCaller {
  key: string;
  name: string;
}

/**
 * An entry belongs to the caller when its key is the caller's key or, for an old entry stored by
 * name only (key `null`), when its name is the caller's name. Another person with the same name
 * and a key of their own is not the caller.
 */
export const isCaller = (reactor: Reactor, caller: ReactionCaller): boolean =>
  reactor.key === null ? reactor.name === caller.name : reactor.key === caller.key;

/** True when the caller is among the reaction's reactors. */
export const hasCaller = (reaction: Reaction | undefined, caller: ReactionCaller): boolean =>
  !!reaction && reaction.reactors.some((r) => isCaller(r, caller));

/** Add the caller to `emoji`'s reaction (creating it); no-op when already there. Mutates `reactions`. */
export function addCaller(reactions: Reaction[], emoji: string, caller: ReactionCaller): void {
  const reaction = reactions.find((r) => r.emoji === emoji);
  const entry: Reactor = { key: caller.key, name: caller.name };
  if (!reaction) reactions.push({ emoji, reactors: [entry] });
  else if (!hasCaller(reaction, caller)) reaction.reactors.push(entry);
}

/** Remove the caller's entry from `emoji`'s reaction, dropping the reaction when it empties. Returns the new list; no-op when absent. */
export function removeCaller(reactions: Reaction[], emoji: string, caller: ReactionCaller): Reaction[] {
  const reaction = reactions.find((r) => r.emoji === emoji);
  if (!reaction) return reactions;
  reaction.reactors = reaction.reactors.filter((r) => !isCaller(r, caller));
  return reaction.reactors.length ? reactions : reactions.filter((r) => r !== reaction);
}
