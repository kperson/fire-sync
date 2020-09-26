const functions = require('firebase-functions')
const admin = require('firebase-admin')
admin.initializeApp()
const express = require('express')
const e = require('express')
const app = express()

const addMessageToMember = (namespace, message, memberId, groupId) => {
    const createdAt = Math.round(new Date().getTime()/1000)
    const payload = {message: message, createdAt: createdAt}
    if(groupId !== null) {
        payload.groupId = groupId
    }
    return admin.database().ref(namespace + '/members/' + memberId).child('messages').push(payload)
}

const fetchGroup = (namespace, groupId) => {
    return admin.database().ref(namespace + '/groups/' + groupId).once('value').then((snap) => {
        if(snap.exists()) {
            const members = snap.child('members').exists() ? snap.child('members').val() : {}
            return {
                groupId: groupId, 
                members: members
            }
        }
        else {
            return null
        }
    })
}


const hasToken = (namespace, token) => {
    return admin.database().ref(namespace + '/tokens/' + token).once('value').then((snap) => {
        return snap.exists()
    })
}

const hasTokens = (namespace) => {
    return admin.database().ref(namespace + '/tokens').once('value').then((snap) => {
        return snap.exists()
    })
}

const authenticate = async (req, res, next) => {
    if('x-namespace' in req.headers) {
        const namespace = req.headers['x-namespace']
        if ('x-token' in req.headers) {
            hasToken(namespace, req.headers['x-token']).then((exists) => {
                if(exists) {
                    req.namespace = namespace
                    next()
                }
                else {
                    res.status(403).send('Unauthorized')
                }
            })
        }
        else {
            hasTokens(namespace).then((exists) => {
                if(exists) {
                    res.status(403).send('Unauthorized')                
                }
                else {
                    req.namespace = namespace
                    next()
                }
            })
        }
    }
    else {
        res.status(403).send('Unauthorized')
    }
}
app.use(authenticate)


app.post('/admin/token', async (req, res) => {
    const token = req.body.token
    await admin.database().ref(req.namespace).child('tokens').child(token).set(true)
    res.status(200).json({token: token})
})

app.delete('/admin/token/:tokenId', async (req, res) => {
    const token = req.params.tokenId
    await admin.database().ref(req.namespace).child('tokens').child(token).remove()
    res.status(200).json({token: token})
})

app.post('/group', async (req, res) => {
    const groupId = req.body.groupId
    const group = {
        groupId: groupId,
        members: {}
    }
    await admin.database().ref(req.namespace).child('groups').child(groupId).set(group)
    res.status(200).json(group)
})

app.get('/group/:groupId', async (req, res) => {
    const groupId = req.params.groupId
    await fetchGroup(groupId).then((group) => {
        if(group === null) {
            res.status(404).json({
                message: 'group not found', 
                context: {
                    groupId: groupId
                }
            })
        }
        else {
            res.status(200).json(group)
        }
        
    })
})

app.delete('/group/:groupId', async (req, res) => {
    const groupId = req.params.groupId
    await admin.database().ref(req.namespace).child('groups').child(groupId).remove()
    res.status(200).json({groupId: groupId})
})

app.post('/group/:groupId/member', async (req, res) => {
    const groupId = req.params.groupId
    const memberId = req.body.memberId
    const createdAt = Math.round(new Date().getTime()/1000)
    await admin.database().ref(req.namespace + '/groups/' + groupId + '/members').child(memberId).set({
        createdAt: createdAt
    })
    res.status(200).json({groupId: groupId, memberId: memberId, createdAt: createdAt})
})

app.post('/group/:groupId/message', async (req, res) => {
    const message = req.body.message
    const groupId = req.params.groupId
    await admin.database().ref(req.namespace + '/groups/' + groupId + '/messages').push(message)
    res.status(200).json({message: message})
})

app.delete('/group/:groupId/member/:memberId', async (req, res) => {
    const groupId = req.params.groupId
    const memberId = req.params.memberId
    await admin.database().ref(req.namespace + '/groups/' + groupId + '/members').child(memberId).remove()
    res.status(200).json({groupId: groupId, memberId: memberId})
})

app.post('/member/:memberId/message', async (req, res) => {
    const memberId = req.params.memberId
    const message = req.body.message
    await admin.database().ref(req.namespace + '/members/' + memberId).child('queue').push(message)
    res.status(200).json({message: message, memberId: memberId})
})

app.post('/member/:memberId/token', async (req, res) => {
    const memberId = req.params.memberId
    admin.auth().createCustomToken(memberId)
    .then((token) => {
        res.status(200).json({token: token})
    })
})

app.post('/group/:groupId/state/set', async (req, res) => {
    const groupId = req.params.groupId
    const payload = req.body.payload
    const path = req.body.path
    await admin.database().ref(req.namespace + '/groups/' + groupId + '/state' + path).set(payload).then((x) => {
        res.status(200).json({groupId: groupId, payload: payload, path: path})
    })
})

app.post('/group/:groupId/state/push', async (req, res) => {
    const groupId = req.params.groupId
    const payload = req.body.payload
    const path = req.body.path
    if('id' in req.body) {
        const id = req.body.id
        await admin.database().ref(req.namespace + '/groups/' + groupId + '/state' + path).child(id).set(payload).then((x) => {
            res.status(200).json({groupId: groupId, payload: payload, path: path, id: id})
        })
    }
    else {
        await admin.database().ref(req.namespace + '/groups/' + groupId + '/state' + path).push(payload).then((x) => {
            res.status(200).json({groupId: groupId, payload: payload, path: path})
        })
    }
})

//https://firebase.google.com/docs/functions/database-events
exports.sendGroupMessage = functions.database.ref('/{namespace}/groups/{groupId}/messages/{messageId}').onCreate((snap, context) => {
    const groupId = context.params.groupId
    const namespace = context.params.namespace
    const message = snap.val()
    return fetchGroup(namespace, groupId).then((group) => {
        const memberIds = Object.keys(group.members)
        return Promise.all(memberIds.map((memberId) =>
            addMessageToMember(namespace, message, memberId, groupId)
        ))
    }).then((x) => {
        return admin.database().ref(namespace + '/groups/' + groupId + '/messages').child(snap.key).remove()
    })
})

exports.addToPersonalMessage = functions.database.ref('/{namespace}/members/{memberId}/queue/{messageId}').onCreate((snap, context) => {
    const memberId = context.params.memberId
    const namespace = context.params.namespace
    const message = snap.val()
    addMessageToMember(namespace, message, memberId, null).then((x) => {
        return admin.database().ref(namespace + '/members/' + memberId + '/queue').child(snap.key).remove()
    })
})

exports.api = functions.https.onRequest(app)