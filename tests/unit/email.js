const assert = require("assert");
const getMandrillFields = require('rewire')('../../src/helpers/email').__get__('getMandrillFields');

describe('send', function () {
    it('getMandrillFields', function () {
        const templateName = 'template-name';
        assert.deepStrictEqual(
            getMandrillFields(
                templateName,
                {
                    a: 1,
                    b: {
                        c: true,
                        d: {
                            e: 'f'
                        }
                    }
                }
            ),
            {
                subject: null,
                text: null,
                html: null,
                from: null,
                mandrillOptions: {
                    template_name: templateName,
                    template_content: [],
                    message: {
                        global_merge_vars: [
                            {
                                name: 'a',
                                content: 1
                            },
                            {
                                name: 'b',
                                content: {
                                    c: true,
                                    d: {
                                        e: 'f'
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        );
    });
});