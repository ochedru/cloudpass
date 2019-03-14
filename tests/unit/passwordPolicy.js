const assert = require("assert");
const PasswordPolicy = require('../../src/models').passwordPolicy;
const ApiError = require('../../src/ApiError');

describe('Password policy', function () {

    describe('Password validation', function () {

        it('Passwords length cannot exceed the maximum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1,
                minLowerCase: 0,
                minUpperCase: 0,
                minNumeric: 0,
                minSymbol: 0,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('aa');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 2008
                        && error.message === 'Account password maximum length not satisfied.';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('a');
                },
                ApiError
            );
        });

        it('Passwords length cannot be less than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 2,
                maxLength: 1000,
                minLowerCase: 0,
                minUpperCase: 0,
                minNumeric: 0,
                minSymbol: 0,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('a');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 2007
                        && error.message === 'Account password minimum length not satisfied.';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('aa');
                },
                ApiError
            );
        });

        it('Passwords cannot contain less lower case characters than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1000,
                minLowerCase: 1,
                minUpperCase: 0,
                minNumeric: 0,
                minSymbol: 0,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('A');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 lowercase character(s).';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('a');
                },
                ApiError
            );
        });

        it('Passwords cannot contain less upper case characters than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1000,
                minLowerCase: 0,
                minUpperCase: 1,
                minNumeric: 0,
                minSymbol: 0,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('a');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 uppercase character(s).';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('A');
                },
                ApiError
            );
        });

        it('Passwords cannot contain less numeric characters than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1000,
                minLowerCase: 0,
                minUpperCase: 0,
                minNumeric: 1,
                minSymbol: 0,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('a');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 numeric character(s).';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('1');
                },
                ApiError
            );
        });

        it('Passwords cannot contain less symbolic characters than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1000,
                minLowerCase: 0,
                minUpperCase: 0,
                minNumeric: 0,
                minSymbol: 1,
                minDiacritic: 0
            });

            assert.throws(
                function () {
                    policy.validatePassword('a');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 symbolic character(s).';
                }
            );
            assert.throws(
                () => policy.validatePassword('1'),
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 symbolic character(s).';
                }
            );
            assert.doesNotThrow(
                () => policy.validatePassword('#'),
                ApiError
            );
        });

        it('Passwords cannot contain less diacritic characters than the minimum specified in the password policy', function () {
            const policy = PasswordPolicy.build({
                minLength: 0,
                maxLength: 1000,
                minLowerCase: 0,
                minUpperCase: 0,
                minNumeric: 0,
                minSymbol: 0,
                minDiacritic: 1
            });

            assert.throws(
                function () {
                    policy.validatePassword('a');
                },
                function (error) {
                    return error instanceof ApiError
                        && error.status === 400
                        && error.code === 400
                        && error.message === 'Password requires at least 1 diacritic character(s).';
                }
            );
            assert.doesNotThrow(
                function () {
                    policy.validatePassword('\u00e0');
                },
                ApiError
            );
        });

    });
});