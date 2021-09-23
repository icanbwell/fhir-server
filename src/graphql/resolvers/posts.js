const posts = [
  {
    id: '1'
  }
];

const comments = [
  {
    id: '101',
    postId: '1',
    text: 'my comment'
  }
];

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    posts: async (parent, args, context, info) => { return posts;},
    // eslint-disable-next-line no-unused-vars
    post: async (parent, args, context, info) => { return posts[0];},
  },
  Post: {
    // eslint-disable-next-line no-unused-vars
    comments: async (parent, args, context, info) => {
      return comments.filter(x => x.postId === parent.id);
    },
  },
};

