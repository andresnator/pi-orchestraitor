# Quick Decision Flow: "I Can't Test X" (Java)

When the user says "I can't test X", follow this decision tree to identify the right technique (names from Michael Feathers' *Working Effectively with Legacy Code*).

## Can I instantiate the class?

**NO** →
- Constructor with heavy parameters → **Parameterize Constructor** or **Pass Null**
- Hidden dependencies (internal `new`) → **Extract and Override Factory Method**
- Too many constructor params (onion) → **Pass Null** for unused ones
- Singleton/Global → **Introduce Static Setter** or **Replace Global Reference with Getter**
- Long method with many locals → **Break Out Method Object**

## Can I run the method?

**NO** →
- Private method → Change to package-private or **Extract Class**
- Final class → **Adapt Parameter**
- Static method dependency → **Skin and Wrap the API**
- Invisible side effect → **Sensing** with Fake/Mock + **Extract and Override Call**

## Can I observe the results?

**NO** →
- Method returns void → Use **Sensing** — inject a Fake or Mock to capture the effect
- Effect goes to a global/static → **Encapsulate Global Reference**
- Effect is invisible → Draw an **Effect Sketch** to find observation points

## Do I need to add new functionality?

**YES** →
- New logic in the middle of an existing method → **Sprout Method**
- Original's dependencies are impossible → **Sprout Class**
- Behavior before/after → **Wrap Method**
- Decorate the entire class → **Wrap Class**
- Can't modify the original at all → **Programming by Difference** (subclass temporarily)

## Do I need to understand the code first?

**YES** →
- Use **Scratch Refactoring**: refactor aggressively on a throwaway branch to understand, then discard
- Draw an **Effect Sketch**: trace how changes propagate through variables, return values, and state
- List responsibilities: if you say "this class does X **and** Y **and** Z", you have 3 classes
- Then write **Characterization Tests**

## Do I need to change many classes at once?

**YES** → Look for a **Pinch Point** — one method/class that exercises all the classes you need to modify

## Is the code a 3rd-party API dependency?

**YES** → **Skin and Wrap the API** — create a thin interface + production wrapper
