package com.jsh.erp.gateway.wecom;

import com.jsh.erp.exception.BusinessRunTimeException;
import org.junit.Assert;
import org.junit.Test;

/**
 * Phrase / namespace unit tests for AIERP-021A (no Spring context).
 */
public class AierpWecomPartnerMasterDataServicePhraseTest {

    @Test
    public void partnerCreatePhraseAccepted() {
        AierpWecomPartnerMasterDataService.ParsedConfirm p =
                AierpWecomPartnerMasterDataService.parseConfirmPhrase("确认伙伴建档42");
        Assert.assertEquals("CREATE", p.op);
        Assert.assertEquals(42L, p.requestId);
        Assert.assertEquals("确认伙伴建档42", p.phrase);
    }

    @Test
    public void partnerUpdatePhraseAccepted() {
        AierpWecomPartnerMasterDataService.ParsedConfirm p =
                AierpWecomPartnerMasterDataService.parseConfirmPhrase("确认伙伴修改7");
        Assert.assertEquals("UPDATE", p.op);
        Assert.assertEquals(7L, p.requestId);
        Assert.assertEquals("确认伙伴修改7", p.phrase);
    }

    @Test
    public void bareCreatePhraseRejected() {
        try {
            AierpWecomPartnerMasterDataService.parseConfirmPhrase("确认建档42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage().contains("确认伙伴建档"));
        }
    }

    @Test
    public void materialCreatePhraseRejected() {
        try {
            AierpWecomPartnerMasterDataService.parseConfirmPhrase("确认建档物料42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage() != null && ex.getMessage().length() > 0);
        }
    }

    @Test
    public void typedSupplierCreatePhraseRejected() {
        try {
            AierpWecomPartnerMasterDataService.parseConfirmPhrase("确认建档供应商42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage().contains("确认伙伴建档"));
        }
    }

    @Test
    public void phrasePrefixNamespaced() {
        Assert.assertEquals("确认伙伴建档", AierpWecomPartnerMasterDataService.phrasePrefixFor("CREATE"));
        Assert.assertEquals("确认伙伴修改", AierpWecomPartnerMasterDataService.phrasePrefixFor("UPDATE"));
    }
}
