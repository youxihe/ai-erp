package com.jsh.erp.gateway.wecom;

import com.jsh.erp.exception.BusinessRunTimeException;
import org.junit.Assert;
import org.junit.Test;

/**
 * Phrase / namespace unit tests for AIERP-021A (no Spring context).
 * Coordinates with AIERP-021B: material uses 确认建档物料{id}; partner must not accept it.
 */
public class PartnerMasterDataServicePhraseTest {

    @Test
    public void supplierCreatePhraseAccepted() {
        PartnerMasterDataService.ParsedConfirm p =
                PartnerMasterDataService.parseConfirmPhrase("确认建档供应商42");
        Assert.assertEquals("CREATE", p.op);
        Assert.assertEquals("供应商", p.partnerType);
        Assert.assertEquals(42L, p.requestId);
        Assert.assertEquals("确认建档供应商42", p.phrase);
    }

    @Test
    public void customerUpdatePhraseAccepted() {
        PartnerMasterDataService.ParsedConfirm p =
                PartnerMasterDataService.parseConfirmPhrase("确认修改客户7");
        Assert.assertEquals("UPDATE", p.op);
        Assert.assertEquals("客户", p.partnerType);
        Assert.assertEquals(7L, p.requestId);
        Assert.assertEquals("确认修改客户7", p.phrase);
    }

    @Test
    public void bareCreatePhraseRejected() {
        try {
            PartnerMasterDataService.parseConfirmPhrase("确认建档42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage().contains("确认建档供应商"));
        }
    }

    @Test
    public void materialCreatePhraseRejected() {
        try {
            PartnerMasterDataService.parseConfirmPhrase("确认建档物料42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage() != null && ex.getMessage().length() > 0);
        }
    }

    @Test
    public void legacyPartnerPrefixedPhraseRejected() {
        try {
            PartnerMasterDataService.parseConfirmPhrase("确认伙伴建档42");
            Assert.fail("expected reject");
        } catch (BusinessRunTimeException ex) {
            Assert.assertTrue(ex.getMessage().contains("确认建档供应商"));
        }
    }

    @Test
    public void phrasePrefixTypeNamespaced() {
        Assert.assertEquals("确认建档供应商", PartnerMasterDataService.phrasePrefixFor("CREATE", "供应商"));
        Assert.assertEquals("确认修改客户", PartnerMasterDataService.phrasePrefixFor("UPDATE", "客户"));
    }
}
