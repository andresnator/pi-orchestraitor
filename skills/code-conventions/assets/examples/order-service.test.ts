// Example: Vitest test following the code-conventions contract.
// Characterization tests go in a separate permanent file: order-service.characterization.test.ts.
import { describe, expect, it } from 'vitest'
import { invoice, VOLUME_DISCOUNT_THRESHOLD } from './order-service'
import { expectedStandardInvoice, orderWithQuantity, standardOrder } from './order-fixtures'

describe('invoice', () => {
  it('should apply volume discount when quantity exceeds threshold', () => {
    // Given
    const order = orderWithQuantity(VOLUME_DISCOUNT_THRESHOLD + 1)

    // When
    const result = invoice(order)

    // Then
    expect(result.discountRate).toBe(0.1)
  })

  it('should build full invoice when order is standard', () => {
    // Given
    const order = standardOrder()

    // When
    const result = invoice(order)

    // Then — whole-object assert, never field-by-field cascades
    expect(result).toMatchObject(expectedStandardInvoice())
  })
})
