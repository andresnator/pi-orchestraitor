// Example: unit test following the code-conventions contract.
// Characterization tests go in a separate permanent class: OrderServiceCharacterizationTest.
class OrderServiceTest {

    private final OrderService service = new OrderService(new FixedClock(OrderFixtures.FROZEN_NOW));

    @Test
    void shouldApplyVolumeDiscountWhenQuantityExceedsThreshold() {
        // Given
        Order order = OrderFixtures.orderWithQuantity(OrderService.VOLUME_DISCOUNT_THRESHOLD + 1);

        // When
        Invoice invoice = service.invoice(order);

        // Then
        assertThat(invoice.discountRate()).isEqualTo(new BigDecimal("0.10"));
    }

    @Test
    void shouldBuildFullInvoiceWhenOrderIsStandard() {
        // Given
        Order order = OrderFixtures.standardOrder();

        // When
        Invoice invoice = service.invoice(order);

        // Then — whole-object assert, never field-by-field cascades
        assertThat(invoice)
                .usingRecursiveComparison()
                .isEqualTo(OrderFixtures.expectedStandardInvoice());
    }
}
